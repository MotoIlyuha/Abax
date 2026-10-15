import type { Camera, Element, Handle, Pt, ShapeEl, ToolId } from './types';
import {
  state, update, onChange, beginStroke, extendStroke, endStroke, pushHistory, replaceElements,
  addElement, setSelection, deleteSelected, undo, redo, setTool, uid, commitPoly,
  expandSelectionWithGroups, groupSelected, ungroupSelected,
} from './state';
import {
  hitTest, aabbIntersects, elementAABB, elementHandles, applyHandle,
  insertPolyNode, removePolyNode, gridStepFor, snapValue,
} from './geom';
import { collabActive, noteCursor, readOnly } from './collab';
import { eraseRadius } from './renderer';
import { beginTextEdit, exportPng, fitContent, saveNow, toggleSidebar } from './app';

const SELECT_TOL = 6; // px экрана
const HANDLE_HIT_PX = 8;
const POLY_SNAP_PX = 14; // радиус примагничивания к первой точке
const CURSORS: Record<ToolId, string> = {
  select: 'default', pen: 'crosshair', highlighter: 'crosshair', eraser: 'none',
  pan: 'grab', text: 'text', note: 'crosshair', rect: 'crosshair',
  ellipse: 'crosshair', line: 'crosshair', arrow: 'crosshair', poly: 'crosshair', laser: 'none',
};
const TOOL_BY_CODE: Record<string, ToolId> = {
  KeyV: 'select', KeyP: 'pen', KeyM: 'highlighter', KeyE: 'eraser', KeyH: 'pan',
  KeyT: 'text', KeyN: 'note', KeyR: 'rect', KeyO: 'ellipse', KeyL: 'line', KeyA: 'arrow',
  KeyI: 'laser', KeyK: 'poly',
};
const MOVE_THRESHOLD_PX = 3;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 32;

type Action = { pid: number } & (
  | { kind: 'draw' }
  | { kind: 'erase'; pre: Element[]; removed: Element[] }
  | { kind: 'move'; pre: Element[]; start: Pt; orig: Map<string, Element>; moved: boolean; deselectOnUp: boolean }
  | { kind: 'shape' }
  | { kind: 'handle'; el: Element; h: Handle; pre: Element[]; changed: boolean; rotBase?: { a0: number; rot0: number } }
  | { kind: 'marquee' }
  | { kind: 'pan'; sx: number; sy: number; cam: Camera }
  | { kind: 'click'; x: number; y: number; target: 'text' | 'note' }
);

interface Ptr { x: number; y: number; type: string }

export function initController(canvas: HTMLCanvasElement): void {
  const pointers = new Map<number, Ptr>();
  let gesture: { dist: number; mx: number; my: number; cam: Camera } | null = null;
  let touchBlocked = false; // после жеста оставшийся палец не должен рисовать
  let action: Action | null = null;
  let spacePan = false;

  onChange(() => { canvas.style.cursor = spacePan ? 'grab' : CURSORS[state.tool]; });

  // clientX - rect вместо offsetX: одинаковая семантика, но работает с pointer capture
  // за пределами канваса и не зависит от способа создания события.
  function localPos(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const toScene = (sx: number, sy: number): Pt => ({
    x: sx / state.camera.zoom + state.camera.x,
    y: sy / state.camera.zoom + state.camera.y,
    p: 0.5,
  });
  const activeTool = (): ToolId => (spacePan ? 'pan' : state.tool);
  const touchPtrs = (): Ptr[] => [...pointers.values()].filter(p => p.type === 'touch');

  const topHit = (x: number, y: number): Element | null => {
    const tol = SELECT_TOL / state.camera.zoom;
    const els = state.board.elements;
    for (let i = els.length - 1; i >= 0; i--) {
      if (hitTest(els[i], x, y, tol)) return els[i];
    }
    return null;
  };

  function zoomAtScreen(sx: number, sy: number, factor: number): void {
    const cam = state.camera;
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom * factor));
    const sceneX = sx / cam.zoom + cam.x;
    const sceneY = sy / cam.zoom + cam.y;
    state.camera = { zoom, x: sceneX - sx / zoom, y: sceneY - sy / zoom };
    update();
  }

  function zoomAtCenter(factor: number): void {
    const r = canvas.getBoundingClientRect();
    zoomAtScreen(r.width / 2, r.height / 2, factor);
  }

  function translateEl(el: Element, dx: number, dy: number): Element {
    if (el.type === 'stroke' || el.type === 'poly') {
      return { ...el, pts: el.pts.map(p => ({ x: p.x + dx, y: p.y + dy, p: p.p })) };
    }
    return { ...el, x: el.x + dx, y: el.y + dy };
  }

  function eraseAt(x: number, y: number, a: Extract<Action, { kind: 'erase' }>): void {
    const r = eraseRadius / state.camera.zoom;
    const before = state.board.elements;
    const next: Element[] = [];
    let removedNow = 0;
    for (const el of before) {
      if (hitTest(el, x, y, r)) { a.removed.push(el); removedNow++; }
      else next.push(el);
    }
    if (removedNow) replaceElements(next);
  }

  function finishShape(): void {
    const ls = state.liveShape;
    state.liveShape = null;
    if (!ls) { update(); return; }
    const w = ls.x1 - ls.x0;
    const h = ls.y1 - ls.y0;
    if (Math.hypot(w, h) * state.camera.zoom < 3) { update(); return; } // случайный клик
    let el: ShapeEl = { id: uid(), type: 'shape', shape: ls.shape, x: ls.x0, y: ls.y0, w, h, color: ls.color, width: ls.width };
    if (ls.shape === 'rect' || ls.shape === 'ellipse') {
      el = { ...el, x: Math.min(ls.x0, ls.x1), y: Math.min(ls.y0, ls.y1), w: Math.abs(w), h: Math.abs(h) };
    }
    addElement(el);
  }

  function finishMarquee(): void {
    const m = state.marquee;
    state.marquee = null;
    if (!m) { update(); return; }
    const s0x = Math.min(m.x0, m.x1) / state.camera.zoom + state.camera.x;
    const s0y = Math.min(m.y0, m.y1) / state.camera.zoom + state.camera.y;
    const s1x = Math.max(m.x0, m.x1) / state.camera.zoom + state.camera.x;
    const s1y = Math.max(m.y0, m.y1) / state.camera.zoom + state.camera.y;
    const rect = { x0: s0x, y0: s0y, x1: s1x, y1: s1y };
    setSelection(
      expandSelectionWithGroups(
        new Set(
          state.board.elements
            .filter(el => aabbIntersects(elementAABB(el), rect))
            .map(el => el.id),
        ),
      ),
    );
  }

  function finishAction(): void {
    const a = action;
    action = null;
    if (!a) return;
    switch (a.kind) {
      case 'draw': endStroke(); break;
      case 'erase':
        if (a.removed.length) pushHistory(a.pre);
        update();
        break;
      case 'shape': finishShape(); break;
      case 'move':
        state.liveEdit = false;
        if (a.moved) pushHistory(a.pre);
        else if (a.deselectOnUp) setSelection([]);
        update();
        break;
      case 'handle':
        state.liveEdit = false;
        if (a.changed) pushHistory(a.pre);
        update();
        break;
      case 'marquee': finishMarquee(); break;
      case 'click': beginTextEdit({ at: { x: a.x, y: a.y }, target: a.target }); break;
      case 'pan':
        canvas.style.cursor = CURSORS[activeTool()];
        update();
        break;
    }
  }

  function onPointerDown(e: PointerEvent): void {
    canvas.setPointerCapture(e.pointerId);
    const lp = localPos(e);
    pointers.set(e.pointerId, { x: lp.x, y: lp.y, type: e.pointerType });

    // совместный режим: на странице без права edit правки запрещены
    if (collabActive() && readOnly() && activeTool() !== 'pan' && e.button !== 1) return;


    const touches = touchPtrs();
    if (e.pointerType === 'touch' && touches.length === 2) {
      finishAction(); // жест двумя пальцами прерывает текущее действие
      const [a, b] = touches;
      gesture = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
        cam: { ...state.camera },
      };
      return;
    }
    if (gesture || action) return;

    if (e.button === 1 || activeTool() === 'pan') {
      e.preventDefault();
      action = { pid: e.pointerId, kind: 'pan', sx: lp.x, sy: lp.y, cam: { ...state.camera } };
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    const s = toScene(lp.x, lp.y);
    const tool = activeTool();
    switch (tool) {
      case 'pen':
      case 'highlighter':
        beginStroke(tool, { x: s.x, y: s.y, p: pressureOf(e) });
        action = { pid: e.pointerId, kind: 'draw' };
        break;
      case 'eraser': {
        const a: Extract<Action, { kind: 'erase' }> = { pid: e.pointerId, kind: 'erase', pre: state.board.elements, removed: [] };
        action = a;
        eraseAt(s.x, s.y, a);
        break;
      }
      case 'rect':
      case 'ellipse':
      case 'line':
      case 'arrow':
        state.liveShape = { shape: tool, ax0: s.x, ay0: s.y, x0: s.x, y0: s.y, x1: s.x, y1: s.y, color: state.style.color, width: state.style.width * 1.3 };
        action = { pid: e.pointerId, kind: 'shape' };
        update();
        break;
      case 'select': {
        // сперва ручки редактирования у единственного выделенного
        if (state.selection.size === 1) {
          const sel = state.board.elements.find(e => state.selection.has(e.id));
          if (sel) {
            const hs = elementHandles(sel, state.camera.zoom);
            const r = HANDLE_HIT_PX / state.camera.zoom;
            for (const hp of hs) {
              if (Math.hypot(hp.x - s.x, hp.y - s.y) <= r) {
                state.liveEdit = true;
                if (sel.type === 'poly' && hp.h.kind === 'insert') {
                  // вставка узла на месте ручки — и сразу тянем его
                  const withNode = insertPolyNode(sel, hp.h.i, { x: s.x, y: s.y, p: 0.5 });
                  const pre = state.board.elements;
                  pushHistory(pre);
                  replaceElements(state.board.elements.map(x => (x.id === sel.id ? withNode : x)));
                  action = { pid: e.pointerId, kind: 'handle', el: withNode, h: { kind: 'node', i: hp.h.i + 1 }, pre, changed: false };
                  return;
                }
                action = { pid: e.pointerId, kind: 'handle', el: sel, h: hp.h, pre: state.board.elements, changed: false };
                if (hp.h.kind === 'rotate' && (sel.type === 'shape' || sel.type === 'image')) {
                  // базовый угол: поворот относительно позиции захвата, без скачка при старте
                  const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2;
                  action.rotBase = { a0: Math.atan2(s.y - cy, s.x - cx), rot0: sel.rot ?? 0 };
                }
                return;
              }
            }
          }
        }
        const hit = topHit(s.x, s.y);
        if (hit) {
          const groupIds = expandSelectionWithGroups(new Set([hit.id]));
          // был ли элемент уже выделен ДО этого клика (для снятия по повторному клику)
          const wasSelected = !e.shiftKey && state.selection.has(hit.id) && groupIds.length === state.selection.size && groupIds.every(id => state.selection.has(id));
          if (e.shiftKey) {
            const sel = new Set(state.selection);
            const removing = sel.has(hit.id);
            for (const id of groupIds) {
              if (removing) sel.delete(id); else sel.add(id);
            }
            setSelection([...sel]);
          } else if (!state.selection.has(hit.id)) {
            setSelection(groupIds);
          }
          const orig = new Map<string, Element>();
          for (const id of state.selection) {
            const el = state.board.elements.find(x => x.id === id);
            if (el) orig.set(id, el);
          }
          action = { pid: e.pointerId, kind: 'move', pre: state.board.elements, start: s, orig, moved: false, deselectOnUp: wasSelected };
          state.liveEdit = true;
        } else {
          if (!e.shiftKey) setSelection([]);
          action = { pid: e.pointerId, kind: 'marquee' };
          state.marquee = { x0: lp.x, y0: lp.y, x1: lp.x, y1: lp.y };
          update();
        }
        break;
      }
      case 'text':
        action = { pid: e.pointerId, kind: 'click', x: s.x, y: s.y, target: 'text' };
        break;
      case 'note':
        action = { pid: e.pointerId, kind: 'click', x: s.x, y: s.y, target: 'note' };
        break;
      case 'poly': {
        // клик-клик: добавление вершин; клик по первой точке замыкает контур
        if (!state.livePoly) {
          state.livePoly = { pts: [{ x: s.x, y: s.y, p: 0.5 }], cursor: { x: s.x, y: s.y, p: 0.5 } };
        } else {
          const first = state.livePoly.pts[0];
          const distScreen = Math.hypot(first.x - s.x, first.y - s.y) * state.camera.zoom;
          if (state.livePoly.pts.length >= 3 && distScreen <= POLY_SNAP_PX) {
            commitPoly(true);
          } else {
            state.livePoly.pts.push({ x: s.x, y: s.y, p: 0.5 });
          }
        }
        update();
        break;
      }
      case 'laser':
        break; // указка не создаёт действий — след рисуется в onPointerMove
    }
  }

  function applyGesture(): void {
    const touches = touchPtrs();
    if (!gesture || touches.length < 2) return;
    const [a, b] = touches;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, gesture.cam.zoom * (dist / gesture.dist)));
    // сцена под стартовой серединой остаётся под текущей серединой
    const smx = gesture.mx / gesture.cam.zoom + gesture.cam.x;
    const smy = gesture.my / gesture.cam.zoom + gesture.cam.y;
    state.camera = { zoom, x: smx - mx / zoom, y: smy - my / zoom };
    update();
  }

  function coalesced(e: PointerEvent): PointerEvent[] {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    return evs.length ? evs : [e];
  }

  /** Шаг привязки к сетке с учётом текущего масштаба; 0 — привязка выключена. */
  function snapStepNow(): number {
    return state.settings.snapToGrid ? gridStepFor(state.camera.zoom) : 0;
  }

  function onPointerMove(e: PointerEvent): void {
    const lp = localPos(e);
    const ptr = pointers.get(e.pointerId);
    if (ptr) { ptr.x = lp.x; ptr.y = lp.y; }
    state.hover = { x: lp.x, y: lp.y };
    if (collabActive()) noteCursor(lp.x / state.camera.zoom + state.camera.x, lp.y / state.camera.zoom + state.camera.y);
    if (state.tool === 'eraser') update();

    if (gesture) { applyGesture(); return; }
    if (touchBlocked && e.pointerType === 'touch') return;
    if (state.tool === 'laser') {
      const sp = toScene(lp.x, lp.y);
      state.laserPts.push({ x: sp.x, y: sp.y, t: performance.now() });
      if (state.laserPts.length > 400) state.laserPts.splice(0, state.laserPts.length - 400);
      update();
    }
    if (state.tool === 'poly' && state.livePoly) {
      const sp = toScene(lp.x, lp.y);
      state.livePoly.cursor = { x: sp.x, y: sp.y, p: 0.5 };
      update();
    }
    const a = action;
    if (!a || a.pid !== e.pointerId) return;

    switch (a.kind) {
      case 'pan': {
        const zoom = a.cam.zoom;
        state.camera = {
          ...a.cam,
          x: a.cam.x - (lp.x - a.sx) / zoom,
          y: a.cam.y - (lp.y - a.sy) / zoom,
        };
        update();
        break;
      }
      case 'draw':
        for (const ev of coalesced(e)) {
          const c = localPos(ev);
          const s = toScene(c.x, c.y);
          extendStroke({ x: s.x, y: s.y, p: pressureOf(ev) });
        }
        break;
      case 'erase':
        for (const ev of coalesced(e)) {
          const c = localPos(ev);
          const s = toScene(c.x, c.y);
          eraseAt(s.x, s.y, a);
        }
        break;
      case 'shape': {
        const s = toScene(lp.x, lp.y);
        const ls = state.liveShape;
        if (ls) {
          // модификаторы как при resize: Alt — от центра, Shift/Ctrl — пропорции/45°
          let dx = s.x - ls.ax0, dy = s.y - ls.ay0;
          if (e.shiftKey || e.ctrlKey) {
            if (ls.shape === 'rect' || ls.shape === 'ellipse') {
              const m = Math.max(Math.abs(dx), Math.abs(dy));
              const sgnX = Math.sign(dx) || 1, sgnY = Math.sign(dy) || 1;
              dx = sgnX * m;
              dy = sgnY * m;
            } else {
              // линия/стрелка: примагничивание к кратным 45°
              const len = Math.hypot(dx, dy);
              const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
              dx = Math.cos(a) * len;
              dy = Math.sin(a) * len;
            }
          }
          if (e.altKey) {
            ls.x0 = ls.ax0 - dx;
            ls.y0 = ls.ay0 - dy;
            ls.x1 = ls.ax0 + dx;
            ls.y1 = ls.ay0 + dy;
          } else {
            ls.x0 = ls.ax0;
            ls.y0 = ls.ay0;
            ls.x1 = ls.ax0 + dx;
            ls.y1 = ls.ay0 + dy;
          }
        }
        update();
        break;
      }
      case 'handle': {
        const s = toScene(lp.x, lp.y);
        const step = snapStepNow();
        const snapped = { x: snapValue(s.x, step), y: snapValue(s.y, step), p: s.p };
        let rotateAngle: number | undefined;
        if (a.h.kind === 'rotate' && a.rotBase && (a.el.type === 'shape' || a.el.type === 'image')) {
          // относительный поворот: насколько курсор обошёл центр с момента захвата
          const cx = a.el.x + a.el.w / 2, cy = a.el.y + a.el.h / 2;
          const a1 = Math.atan2(snapped.y - cy, snapped.x - cx);
          rotateAngle = a.rotBase.rot0 + (a1 - a.rotBase.a0);
        }
        const next = applyHandle(a.el, a.h, snapped, { proportional: e.shiftKey || e.ctrlKey, fromCenter: e.altKey }, rotateAngle);
        replaceElements(state.board.elements.map(x => (x.id === a.el.id ? next : x)));
        a.changed = true;
        break;
      }
      case 'move': {
        const s = toScene(lp.x, lp.y);
        let dx = s.x - a.start.x;
        let dy = s.y - a.start.y;
        if (!a.moved && Math.hypot(dx, dy) * state.camera.zoom < MOVE_THRESHOLD_PX) break;
        a.moved = true;
        const step = snapStepNow();
        if (step > 0 && a.orig.size > 0) {
          // дельта привязки считается по опорному элементу, взаимное расположение сохраняется
          const ref = a.orig.values().next().value as Element;
          const rx = ref.type === 'stroke' || ref.type === 'poly' ? ref.pts[0].x : ref.x;
          const ry = ref.type === 'stroke' || ref.type === 'poly' ? ref.pts[0].y : ref.y;
          dx = snapValue(rx + dx, step) - rx;
          dy = snapValue(ry + dy, step) - ry;
        }
        replaceElements(
          state.board.elements.map(el => (a.orig.has(el.id) ? translateEl(a.orig.get(el.id)!, dx, dy) : el)),
        );
        break;
      }
      case 'marquee':
        if (state.marquee) { state.marquee.x1 = lp.x; state.marquee.y1 = lp.y; }
        update();
        break;
    }
  }

  function onPointerUp(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (gesture) {
      if (touchPtrs().length < 2) {
        gesture = null;
        if (touchPtrs().length > 0) touchBlocked = true;
      }
      return;
    }
    if (touchBlocked && touchPtrs().length === 0) touchBlocked = false;
    if (action && action.pid !== e.pointerId) return;
    finishAction();
  }

  function onPointerLeave(): void {
    state.hover = null;
    if (state.tool === 'eraser') update();
  }

  function onDblClick(e: MouseEvent): void {
    const lp = localPos(e);
    const s = toScene(lp.x, lp.y);
    if (activeTool() === 'poly') {
      if (state.livePoly) commitPoly(false);
      return;
    }
    if (activeTool() !== 'select') return;
    // удаление узла ломаной двойным кликом по ручке
    if (state.selection.size === 1) {
      const sel = state.board.elements.find(el => state.selection.has(el.id));
      if (sel && sel.type === 'poly') {
        const hs = elementHandles(sel, state.camera.zoom);
        const r = HANDLE_HIT_PX / state.camera.zoom;
        for (const hp of hs) {
          if (hp.h.kind === 'node' && Math.hypot(hp.x - s.x, hp.y - s.y) <= r) {
            const reduced = removePolyNode(sel, hp.h.i);
            if (reduced) {
              pushHistory(state.board.elements);
              replaceElements(state.board.elements.map(x => (x.id === sel.id ? (reduced as Element) : x)));
            }
            return;
          }
        }
      }
    }
    const hit = topHit(s.x, s.y);
    if (hit && (hit.type === 'text' || hit.type === 'note')) beginTextEdit({ el: hit });
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const lp = localPos(e);
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    if (e.ctrlKey) {
      // pinch жест точпада приходит как ctrl+wheel
      zoomAtScreen(lp.x, lp.y, Math.exp(-e.deltaY * k * 0.0022));
    } else {
      let dx = e.deltaX * k;
      let dy = e.deltaY * k;
      if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }
      state.camera = {
        ...state.camera,
        x: state.camera.x + dx / state.camera.zoom,
        y: state.camera.y + dy / state.camera.zoom,
      };
      update();
    }
  }

  function isTypingTarget(t: EventTarget | null): boolean {
    return t instanceof HTMLElement && (
      t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
    );
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (isTypingTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey) {
      switch (e.code) {
        case 'KeyZ': e.preventDefault(); if (e.shiftKey) redo(); else undo(); return;
        case 'KeyY': e.preventDefault(); redo(); return;
        case 'KeyS': e.preventDefault(); void saveNow(); return;
        case 'KeyG':
          e.preventDefault();
          if (e.shiftKey) ungroupSelected(); else groupSelected();
          return;
        case 'KeyE': e.preventDefault(); void exportPng(); return;
      }
      return;
    }
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!spacePan) { spacePan = true; canvas.style.cursor = 'grab'; }
        break;
      case 'Escape':
        if (state.livePoly) { state.livePoly = null; update(); break; }
        finishAction();
        break;
      case 'Enter':
        if (state.livePoly) commitPoly(false);
        break;
      case 'Delete':
      case 'Backspace': e.preventDefault(); deleteSelected(); break;
      case 'Equal': zoomAtCenter(1.25); break;
      case 'Minus': zoomAtCenter(1 / 1.25); break;
      case 'Digit0': fitContent(); break;
      case 'KeyB': toggleSidebar(); break;
      default: {
        const tool = TOOL_BY_CODE[e.code];
        if (tool) setTool(tool);
      }
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      spacePan = false;
      canvas.style.cursor = CURSORS[state.tool];
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (state.livePoly) commitPoly(false); // правая кнопка завершает открытую ломаную
  });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}

function pressureOf(e: PointerEvent): number {
  if (e.pointerType === 'mouse') return 0.5;
  return e.pressure > 0 ? e.pressure : 0.5;
}
