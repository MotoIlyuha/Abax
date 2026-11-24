import { stickyTool } from './sticky-tool';
import { geometricFoundationFor, rebindAttachment, reattachMoved, withAttached } from './attachment';
import type { Camera, Element, FadeStroke, Handle, ImageEl, Pt, ShapeEl, ToolId } from './types';
import {
  state, update, onChange, beginStroke, extendStroke, endStroke, pushHistory, replaceElements,
  addElement, setSelection, confirmElementDeletion, deleteSelected, undo, redo, pickTool, uid, commitPoly,
  bringForward, sendBackward, moveSelectionLayer, expandSelectionWithGroups, groupSelected, ungroupSelected, selectAll, selectInserted, opacityField,
  zoomAtPoint, ZOOM_MAX, ZOOM_MIN, insertCopies, isDraftId, touchProject, canCopyCurrentBoard, canTouchElement,
  setFadeStrokeEnd, type LiveStroke,
} from './state';
import { recognizeInkShape } from './ink-shape';
import {
  type AABB, hitTest, erasePart, aabbIntersects, aabbUnion, alignGuides, alignShift, boxAnchors, boxHandles, elementAABB, elementHandles,
  applyHandle, insertPolyNode, removePolyNode, gridStepFor, resizeBox, scaleElement, shapeHoldsText, snapValue, translateElement,
} from './geom';
import { collabActive, foreignElementHint, noteCursor, protectionActive, sendFadeStroke, sendFlash, sendLaser } from './collab';
import { addGestureProbe } from './gesture';
import { isNativeApp } from './native';
import { cursorCss } from './cursors';
import { myCursorId, onProfileChange } from './profile';
import { fxForget, fxMove } from './cursor-fx';
import { settingsDialogOpen } from './settings-dialog';
import { animateInkRecognition, presenting, requestRender, renderScene } from './renderer';
import { animateCameraTo, cancelCameraAnim, clampZoom, motionReduced } from './camera-anim';
import { stopFollowByUser } from './follow';
import { cancelActiveInteraction, onCancelInteraction } from './interaction';

/** Плавный перелёт камеры к мировой точке (SPEC_NIGHT5 §8); прерывается жестом пользователя. */
export { animateCameraTo, cancelActiveInteraction };
import { eraserRadius, resetEraser, trackEraser } from './eraser-size';
import { fitSolid, SOLID_CLICK_SIZE, solidKeepsAspect } from './solid';
import { spreadElements, spreadTargets } from './spread';
import {
  addDraftFromKey, addPageFromKey, beginTextEdit, canEditBoard, closeEditor, copySelectionAsImage, duplicateSelection, editTaskElement, exportPng, fitContent, openAllSettings, openPageLink,
  saveNow, selectedTextShape, switchToPage, switchPageForDrag, toggleTextFlag, togglePages,
} from './app';
import { DRAFT_KEY, comboFromEvent, pageNumberFromEvent } from './hotkeys';
import { devModeEnabled, devPlanStep, limitsEnforced, setLimitsEnforced, setUserPlan, userPlan } from './plan';
import { PLAN_TITLES } from './billing';
import { showToast } from './about';
import { canAnnotate, commentAt } from './comments-ui';
import { COMMENT_TOOL_PATHS, ERASER_PATHS, ERASER_TIP } from './icons';
import { TOOL_DEFS, toolByKey } from './toolbar';
import {
  arrowDirection, arrowStep, isArrowKey, NUDGE_FAST, NUDGE_HOLD_MS, NUDGE_SPEED, NUDGE_STEP, NUDGE_STEP_FAST,
} from './nudge';

const SELECT_TOL = 6; // px экрана
const HANDLE_HIT_PX = 8;
const POLY_SNAP_PX = 14; // радиус примагничивания к первой точке
const OBJECT_ERASE_PX = 2; // радиус объектного ластика, px экрана
/** Курсор объектного ластика — его иконка; белая подложка видна и на тёмном, стирает кончик. */
const ERASER_CURSOR = (() => {
  const paths = ERASER_PATHS.map(d => `<path d="${d}"/>`).join('');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">'
    + `<g fill="#fff" stroke="#fff" stroke-width="4">${paths}</g><g stroke="#1f2329" stroke-width="1.8">${paths}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${ERASER_TIP.x} ${ERASER_TIP.y}, crosshair`;
})();
const COMMENT_CURSOR = (() => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">'
    + `<g stroke="#fff" stroke-width="4">${COMMENT_TOOL_PATHS}</g><g stroke="#1f2329" stroke-width="1.8">${COMMENT_TOOL_PATHS}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 20, crosshair`;
})();
const CURSORS: Record<ToolId, string> = {
  comment: COMMENT_CURSOR,
  select: 'default', pen: 'crosshair', highlighter: 'crosshair', eraser: ERASER_CURSOR, partEraser: 'none',
  pan: 'grab', text: 'text', note: 'crosshair', task: 'default', spread: 'row-resize', rect: 'crosshair',
  ellipse: 'crosshair', triangle: 'crosshair', line: 'crosshair', arrow: 'crosshair', poly: 'crosshair',
  laser: 'none', fadePen: 'crosshair', flash: 'default',
  cube: 'crosshair', box: 'crosshair', prism: 'crosshair', pyramid: 'crosshair', truncPyramid: 'crosshair',
  cylinder: 'crosshair', cone: 'crosshair', truncCone: 'crosshair', sphere: 'crosshair',
};
/** Курсор инструмента над холстом: у «Выделения» — персональный курсор пользователя (SPEC_NIGHT4 §4). */
function cursorFor(tool: ToolId): string {
  return tool === 'select' ? cursorCss(myCursorId()) : CURSORS[tool];
}
const MOVE_THRESHOLD_PX = 3;
const INK_HOLD_MS = 500;
const INK_HOLD_SLOP_PX = 3;
const INK_SAMPLE_STEP_PX = 0.75;
const AUTO_PAN_EDGE = 64;
const AUTO_PAN_SPEED = 600; // px экрана в секунду у самого края
/** Радиус примагничивания к направляющим соседей, px экрана. */
const GUIDE_SNAP_PX = 6;
const LASER_MAX_PTS = 400;
/** Инструменты указки ничего не меняют на доске — доступны и без права правки. */
const POINTER_TOOLS = new Set<ToolId>(['laser', 'fadePen', 'flash']);
/** Клавиши масштаба: работают и при выделенной фигуре с текстовым курсором. */
const ZOOM_KEYS = new Set(['Equal', 'Minus']);

type Action = { pid: number } & (
  | { kind: 'draw'; hold?: InkHold }
  | { kind: 'comment'; sx: number; sy: number; point: { x: number; y: number }; targetId?: string }
  | { kind: 'erase'; pre: Element[]; removed: Element[]; skipped: Set<string>; last: { x: number; y: number } | null }
  | { kind: 'erasePart'; pre: Element[]; changed: boolean; skipped: Set<string>; last: { x: number; y: number } | null }
  | {
    kind: 'move'; pre: Element[]; start: Pt; orig: Map<string, Element>; moved: boolean; deselectOnUp: boolean; duplicate: boolean; source: Element[];
    /** Общая рамка переносимого до начала переноса и рамки соседей для направляющих (null — выключены). */
    box: AABB | null; others: AABB[] | null;
    /** Нажали на страницу на холсте: отпустили не сдвинув — переход на неё. */
    link: ImageEl | null;
  }
  | { kind: 'shape' }
  | { kind: 'solid' }
  | {
    kind: 'handle'; el: Element; h: Handle; pre: Element[]; changed: boolean; rotBase?: { a0: number; rot0: number };
    others: AABB[] | null;
  }
  /** Общий размер выделения: тянем ручку рамки, все элементы масштабируются из исходной рамки. */
  | {
    kind: 'scale'; pre: Element[]; orig: Map<string, Element>; box: AABB; h: Extract<Handle, { kind: 'resize' }>;
    changed: boolean; others: AABB[] | null;
  }
  | { kind: 'marquee'; flash?: boolean }
  | { kind: 'laser' }
  | { kind: 'fade'; stroke: FadeStroke; sid: string }
  | { kind: 'pan'; sx: number; sy: number; cam: Camera }
  /** Раздвигание: ids сдвигаются вниз на dy от линии y (координаты сцены). */
  | { kind: 'spread'; pre: Element[]; ids: Set<string>; y: number; dy: number }
  | { kind: 'click'; x: number; y: number; target: 'text' | 'note' }
);

interface Ptr { x: number; y: number; type: string }

interface InkHold {
  stroke: LiveStroke;
  points: Pt[];
  anchor: { x: number; y: number };
  timer?: ReturnType<typeof setTimeout>;
}

export function initController(canvas: HTMLCanvasElement): void {
  const pointers = new Map<number, Ptr>();
  let gesture: { dist: number; mx: number; my: number; cam: Camera } | null = null;
  let touchBlocked = false; // после жеста оставшийся палец не должен рисовать
  let action: Action | null = null;
  let autoPan: { event: PointerEvent; raf: number; last: number } | null = null;
  let spacePan = false;
  let transfer: { sourceId: string; sourcePage: typeof state.board; source: Element[]; original: Element[]; copy: boolean; ghost: HTMLCanvasElement; hover: string | null; timer: ReturnType<typeof setTimeout> | null; transition: Promise<void> | null } | null = null;
  function clearTransfer(): void {
    if (!transfer) return;
    if (transfer.timer) clearTimeout(transfer.timer);
    transfer.ghost.remove(); transfer = null; state.dragHidden = null;
  }
  function pageUnderPointer(e: PointerEvent): string | null {
    if (!document.querySelector('#pages-dock.open')) return null;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.page-item');
    return target?.dataset.pageId ?? null;
  }
  function updateTransfer(e: PointerEvent, a: Extract<Action, {kind:'move'}>): boolean {
    const tray = document.querySelector<HTMLElement>('#pages-dock.open #pages-tray');
    const rect = tray?.getBoundingClientRect();
    const inTray = !!rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    const scene = toScene(localPos(e).x, localPos(e).y);
    const link = state.settings.pageLinks && !inTray && !transfer?.transition
      ? [...state.board.elements].reverse().find((item): item is ImageEl => item.type === 'image' && !!item.page && item.page !== state.pageId && !a.source.some(source => source.id === item.id) && hitTest(item,scene.x,scene.y,0))
      : undefined;
    if (!transfer && !inTray && !link) return false;
    if (!transfer) {
      const original = a.pre;
      state.board.elements = original;
      state.selection = new Set();
      state.guides = [];
      const bounds = a.source.map(elementAABB).reduce(aabbUnion);
      const scale = Math.min(110 / Math.max(1,bounds.x1-bounds.x0), 80 / Math.max(1,bounds.y1-bounds.y0), state.camera.zoom * .4);
      const ghost = document.createElement('canvas');
      const w = Math.max(1,Math.ceil((bounds.x1-bounds.x0)*scale)), h = Math.max(1,Math.ceil((bounds.y1-bounds.y0)*scale));
      ghost.width=w; ghost.height=h;
      ghost.style.cssText='position:fixed;z-index:9999;pointer-events:none;opacity:.8;box-shadow:0 2px 8px #0003;border-radius:3px;';
      renderScene(ghost.getContext('2d')!,a.source,{x:bounds.x0,y:bounds.y0,zoom:scale},w,h,1,'none');
      document.body.appendChild(ghost);
      transfer={sourceId:state.pageId,sourcePage:state.board,source:a.source,original,copy:a.duplicate,ghost,hover:null,timer:null,transition:null};
      update(true);
    }
    const tr=transfer;
    tr.copy=a.duplicate || (e.altKey && canCopyCurrentBoard());
    const shouldHide = !tr.copy;
    if (shouldHide !== (state.dragHidden !== null)) {
      state.dragHidden = shouldHide ? { pageId: tr.sourceId, ids: new Set(tr.source.map(el => el.id)) } : null;
      update();
    }
    tr.ghost.style.left=`${e.clientX+12}px`; tr.ghost.style.top=`${e.clientY+12}px`;
    const target=pageUnderPointer(e) ?? link?.page ?? null;
    if (target !== tr.hover) {
      if (tr.timer) clearTimeout(tr.timer);
      tr.hover=target; tr.timer=null;
      if (target && target!==state.pageId) tr.timer=setTimeout(() => {
        if (!transfer || transfer!==tr || tr.hover!==target || action!==a) return;
        tr.timer=null;
        if (link && link.page === target) {
          tr.transition = openPageLink(link, true);
          void tr.transition.finally(() => { if (transfer === tr) tr.transition = null; });
        } else switchPageForDrag(target);
      },650);
    }
    return true;
  }


  onChange(() => { canvas.style.cursor = spacePan ? 'grab' : cursorFor(state.tool); });
  // сменили курсор в профиле (или тариф) — курсор над холстом и цвет выделения меняются сразу
  onProfileChange(() => { canvas.style.cursor = spacePan ? 'grab' : cursorFor(state.tool); requestRender(); });

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

  function stopAutoPan(): void {
    if (autoPan) cancelAnimationFrame(autoPan.raf);
    autoPan = null;
  }

  function updateAutoPan(e: PointerEvent): void {
    const p = localPos(e);
    const r = canvas.getBoundingClientRect();
    const velocity = (v: number, size: number) => {
      if (v < 0 || v > size) return 0;
      return Math.max(0, Math.min(1, (v - (size - AUTO_PAN_EDGE)) / AUTO_PAN_EDGE))
        - Math.max(0, Math.min(1, (AUTO_PAN_EDGE - v) / AUTO_PAN_EDGE));
    };
    const direction = () => ({ x: velocity(p.x, r.width), y: velocity(p.y, r.height) });
    // Не прокручиваем, когда указатель покинул холст или переносится на другую страницу.
    if (p.x < 0 || p.y < 0 || p.x > r.width || p.y > r.height || transfer || (!direction().x && !direction().y)) {
      stopAutoPan();
      return;
    }
    if (autoPan) { autoPan.event = e; return; }
    autoPan = { event: e, raf: 0, last: performance.now() };
    const tick = (time: number) => {
      const pan = autoPan;
      if (!pan || (action?.kind !== 'move' && action?.kind !== 'spread') || transfer) { stopAutoPan(); return; }
      const pos = localPos(pan.event);
      const rect = canvas.getBoundingClientRect();
      const dt = Math.min((time - pan.last) / 1000, 0.05);
      pan.last = time;
      stopFollowByUser();
      state.camera.x += velocity(pos.x, rect.width) * AUTO_PAN_SPEED * dt / state.camera.zoom;
      state.camera.y += velocity(pos.y, rect.height) * AUTO_PAN_SPEED * dt / state.camera.zoom;
      onPointerMove(pan.event);
      if (autoPan === pan) pan.raf = requestAnimationFrame(tick);
    };
    autoPan.raf = requestAnimationFrame(tick);
  }

  /** Верхний элемент под точкой; touchable — только те, что можно менять (защита чужих элементов, SPEC_NIGHT6 §4.6). */
  const topHit = (x: number, y: number, touchable = false): Element | null => {
    const tol = SELECT_TOL / state.camera.zoom;
    const els = state.board.elements;
    for (let i = els.length - 1; i >= 0; i--) {
      if (touchable && !canTouchElement(els[i])) continue;
      if (hitTest(els[i], x, y, tol)) return els[i];
    }
    return null;
  };

  /** Наведение на чужой элемент при защите: курсор «нельзя» и подсказка; иначе — как обычно. */
  let foreignHover = false;
  function hoverForeign(x: number, y: number): void {
    if (!protectionActive() || state.tool !== 'select' || spacePan) {
      if (foreignHover) { foreignHover = false; canvas.style.cursor = cursorFor(state.tool); canvas.removeAttribute('title'); }
      return;
    }
    const hit = topHit(x, y);
    const hint = hit && !topHit(x, y, true) ? foreignElementHint(hit) : null;
    if (hint) {
      foreignHover = true;
      canvas.style.cursor = 'not-allowed';
      canvas.title = hint;
    } else if (foreignHover) {
      foreignHover = false;
      canvas.style.cursor = cursorFor(state.tool);
      canvas.removeAttribute('title');
    }
  }

  /** Общая рамка выделения — та же, что рисуется вокруг нескольких объектов. */
  function selectionBox(): AABB | null {
    const boxes = state.board.elements
      .filter(el => state.selection.has(el.id) && el.id !== state.hideElId)
      .map(elementAABB);
    return boxes.length ? boxes.reduce(aabbUnion) : null;
  }

  /**
   * Ручки изменения размера общего выделения: у нескольких объектов — всегда,
   * у одиночного — только если у него нет собственных ручек (например, штрих).
   */
  function selectionFrame(): { box: AABB; handles: ReturnType<typeof boxHandles> } | null {
    const els = state.board.elements.filter(el => state.selection.has(el.id) && el.id !== state.hideElId);
    if (els.length === 0) return null;
    if (els.length === 1 && elementHandles(els[0], state.camera.zoom).length > 0) return null;
    const box = els.map(elementAABB).reduce(aabbUnion);
    return { box, handles: boxHandles(box, state.camera.zoom) };
  }

  function startMove(e: PointerEvent, start: Pt, deselectOnUp: boolean, link: ImageEl | null): void {
    const orig = new Map<string, Element>();
    for (const id of withAttached(state.selection, state.board.elements)) {
      const el = state.board.elements.find(x => x.id === id);
      if (el) orig.set(id, el);
    }
    const others = guideTargets(new Set(orig.keys()));
    const box = others && orig.size > 0 ? [...orig.values()].map(elementAABB).reduce(aabbUnion) : null;
    action = {
      pid: e.pointerId, kind: 'move', pre: state.board.elements, start, orig, moved: false,
      deselectOnUp, box, others, link, duplicate: e.altKey && canCopyCurrentBoard(), source: [...orig.values()],
    };
    // При невыделенных прикреплённых элементах нужен полный рендер всех слоёв.
    state.liveEdit = orig.size === state.selection.size;
  }

  /** Плавный масштаб: событие колеса сдвигает цель, кадры подтягивают к ней текущий масштаб вокруг курсора. */
  const ZOOM_SMOOTH_TAU_MS = 90;
  let zoomGlide: { target: number; sx: number; sy: number; last: number; raf: number; set: number } | null = null;

  function stopZoomGlide(): void {
    if (!zoomGlide) return;
    cancelAnimationFrame(zoomGlide.raf);
    zoomGlide = null;
  }

  function zoomGlideTick(t: number): void {
    const g = zoomGlide;
    if (!g) return;
    // камеру изменили не мы (перетаскивание, перелёт, ввод масштаба) — цель устарела
    if (Math.abs(state.camera.zoom - g.set) > 1e-9) { zoomGlide = null; return; }
    const dt = Math.min(Math.max(t - g.last, 0), 50);
    g.last = t;
    const cur = state.camera.zoom;
    const k = 1 - Math.exp(-dt / ZOOM_SMOOTH_TAU_MS);
    // интерполяция по логарифму: одинаковая скорость приближения и удаления
    let next = Math.exp(Math.log(cur) + (Math.log(g.target) - Math.log(cur)) * k);
    const done = Math.abs(Math.log(g.target / next)) < 0.0005;
    if (done) next = g.target;
    zoomAtPoint(next, g.sx, g.sy);
    g.set = state.camera.zoom;
    if (done) { zoomGlide = null; return; }
    g.raf = requestAnimationFrame(zoomGlideTick);
  }

  /** Инерция камеры после перетаскивания холста («Плавное перемещение»). */
  const PAN_FRICTION_TAU_MS = 160;
  const PAN_MIN_SPEED = 0.02; // экранных px/мс: медленнее — останавливаемся
  let panSamples: { t: number; x: number; y: number }[] = [];
  let panGlide: { vx: number; vy: number; last: number; raf: number } | null = null;

  function stopPanGlide(): void {
    if (!panGlide) return;
    cancelAnimationFrame(panGlide.raf);
    panGlide = null;
  }

  function panGlideTick(t: number): void {
    const g = panGlide;
    if (!g) return;
    const dt = Math.min(Math.max(t - g.last, 0), 50);
    g.last = t;
    const z = state.camera.zoom;
    state.camera = { ...state.camera, x: state.camera.x - g.vx * dt / z, y: state.camera.y - g.vy * dt / z };
    const decay = Math.exp(-dt / PAN_FRICTION_TAU_MS);
    g.vx *= decay; g.vy *= decay;
    update();
    if (Math.hypot(g.vx, g.vy) < PAN_MIN_SPEED) { panGlide = null; return; }
    g.raf = requestAnimationFrame(panGlideTick);
  }

  function startPanGlide(): void {
    const samples = panSamples;
    panSamples = [];
    if (!state.settings.smoothPan || motionReduced() || typeof requestAnimationFrame !== 'function') return;
    const now = performance.now();
    const recent = samples.filter(s => now - s.t <= 100);
    if (recent.length < 2) return; // курсор стоял перед отпусканием — без инерции
    const a = recent[0], b = recent[recent.length - 1];
    const span = b.t - a.t;
    if (span <= 0) return;
    const vx = (b.x - a.x) / span, vy = (b.y - a.y) / span;
    if (Math.hypot(vx, vy) < PAN_MIN_SPEED * 3) return;
    panGlide = { vx, vy, last: now, raf: 0 };
    panGlide.raf = requestAnimationFrame(panGlideTick);
  }

  function zoomAtScreen(sx: number, sy: number, factor: number): void {
    if (motionReduced() || typeof requestAnimationFrame !== 'function') {
      zoomAtPoint(state.camera.zoom * factor, sx, sy);
      return;
    }
    const base = zoomGlide && Math.abs(state.camera.zoom - zoomGlide.set) <= 1e-9 ? zoomGlide.target : state.camera.zoom;
    const target = clampZoom(base * factor);
    if (zoomGlide) {
      zoomGlide.target = target; zoomGlide.sx = sx; zoomGlide.sy = sy;
      return;
    }
    zoomGlide = { target, sx, sy, last: performance.now(), raf: 0, set: state.camera.zoom };
    zoomGlide.raf = requestAnimationFrame(zoomGlideTick);
  }

  function zoomAtCenter(factor: number): void {
    const r = canvas.getBoundingClientRect();
    zoomAtScreen(r.width / 2, r.height / 2, factor);
  }

  /** Объектный ластик: стирает целиком только перо и маркер, всё остальное не трогает. */
  function eraseAt(x: number, y: number, a: Extract<Action, { kind: 'erase' }>): void {
    const r = OBJECT_ERASE_PX / state.camera.zoom;
    // быстрое движение даёт редкие события: проходим путь от прошлой точки с шагом в радиус,
    // иначе тонкая линия между двумя событиями не стирается
    const from = a.last ?? { x, y };
    const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / r));
    a.last = { x, y };
    // радиус маленький, шагов много: проверяем только элементы, чья рамка задевает путь
    const path = { x0: Math.min(from.x, x), y0: Math.min(from.y, y), x1: Math.max(from.x, x), y1: Math.max(from.y, y) };
    const near = state.board.elements.filter(el => {
      if (el.type !== 'stroke' || a.skipped.has(el.id) || !canTouchElement(el)) return false; // чужие штрихи при защите не стираются
      const pad = r + ('width' in el ? el.width : 0); // у линии рамка без толщины
      const b = elementAABB(el);
      return aabbIntersects({ x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad }, path);
    });
    const removed = new Set<Element>();
    for (let i = 1; i <= steps && removed.size < near.length; i++) {
      const px = from.x + ((x - from.x) * i) / steps;
      const py = from.y + ((y - from.y) * i) / steps;
      for (const el of near) {
        if (!removed.has(el) && hitTest(el, px, py, r)) removed.add(el);
      }
    }
    if (removed.size === 0) return;
    if (!confirmElementDeletion(new Set([...removed].map(el => el.id)))) {
      for (const el of removed) a.skipped.add(el.id);
      return;
    }
    a.removed.push(...removed);
    replaceElements(state.board.elements.filter(el => !removed.has(el)));
  }

  /** Ластик для пера и маркера: вырезает из линий часть под ластиком, остальное не трогает. */
  function erasePartAt(x: number, y: number, a: Extract<Action, { kind: 'erasePart' }>): void {
    const r = eraserRadius() / state.camera.zoom;
    const from = a.last ?? { x, y };
    const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / r));
    a.last = { x, y };
    let next = state.board.elements;
    let changed = false;
    for (let i = 1; i <= steps; i++) {
      const px = from.x + ((x - from.x) * i) / steps;
      const py = from.y + ((y - from.y) * i) / steps;
      const out: Element[] = [];
      for (const el of next) {
        if (el.type !== 'stroke' || a.skipped.has(el.id) || !canTouchElement(el)) { out.push(el); continue; }
        const stroke = el;
        const pieces = erasePart(stroke.pts, stroke.width, px, py, r);
        if (!pieces) { out.push(stroke); continue; }
        if (pieces.length === 0 && !confirmElementDeletion(new Set([stroke.id]))) {
          a.skipped.add(stroke.id);
          out.push(stroke);
          continue;
        }
        changed = true;
        // куски — на месте линии (порядок слоёв сохраняется); первый оставляет её id
        pieces.forEach((pts, k) => out.push({ ...stroke, id: k === 0 ? stroke.id : uid(), pts }));
      }
      next = out;
    }
    if (changed) { a.changed = true; replaceElements(next); }
  }

  function finishShape(): void {
    const ls = state.liveShape;
    state.liveShape = null;
    if (!ls) { update(); return; }
    const w = ls.x1 - ls.x0;
    const h = ls.y1 - ls.y0;
    if (Math.hypot(w, h) * state.camera.zoom < 3) { update(); return; } // случайный клик
    let el: ShapeEl = { id: uid(), type: 'shape', shape: ls.shape, x: ls.x0, y: ls.y0, w, h, color: ls.color, width: ls.width, ...opacityField(ls.opacity) };
    if (ls.shape !== 'line' && ls.shape !== 'arrow') {
      el = { ...el, x: Math.min(ls.x0, ls.x1), y: Math.min(ls.y0, ls.y1), w: Math.abs(w), h: Math.abs(h) };
    }
    addElement(el);
    // двойной щелчок по кнопке группы — режим массового добавления: инструмент остаётся, фигура не выделяется
    if (stickyTool() === state.tool) { update(); return; }
    // фигура сразу выделена: её двигают, а в прямоугольник, эллипс и треугольник сразу пишут текст
    selectInserted(el.id);
  }

  function finishSolid(): void {
    const ls = state.liveSolid;
    state.liveSolid = null;
    if (!ls) { update(); return; }
    const z = state.camera.zoom;
    let { x0, y0, x1, y1 } = ls;
    if (Math.hypot(x1 - x0, y1 - y0) * z < 3) {
      // клик без протягивания — тело стандартного размера с центром в точке клика
      const [w, h] = SOLID_CLICK_SIZE[ls.solid];
      x0 = ls.ax0 - w / (2 * z); x1 = ls.ax0 + w / (2 * z);
      y0 = ls.ay0 - h / (2 * z); y1 = ls.ay0 + h / (2 * z);
    }
    const el = { ...fitSolid(ls.solid, x0, y0, x1, y1, { id: uid(), color: ls.color, width: ls.width }), ...opacityField(ls.opacity) };
    addElement(el);
    if (stickyTool() === state.tool) { update(); return; } // массовое добавление
    // тело сразу выделено: его параметры правятся ручками
    selectInserted(el.id);
  }

  /** Рамки видимых соседей — опоры направляющих выравнивания; null — направляющие выключены в настройках. */
  function guideTargets(exclude: Set<string>): AABB[] | null {
    if (!state.settings.alignGuides) return null;
    const r = canvas.getBoundingClientRect();
    const cam = state.camera;
    const view = { x0: cam.x, y0: cam.y, x1: cam.x + r.width / cam.zoom, y1: cam.y + r.height / cam.zoom };
    const out: AABB[] = [];
    for (const el of state.board.elements) {
      if (exclude.has(el.id)) continue;
      const b = elementAABB(el);
      if (aabbIntersects(b, view)) out.push(b);
    }
    return out;
  }

  /** Направляющие по осям для рамки box: xs и ys — её опорные линии, которые сейчас тянут. */
  function showGuides(box: AABB, xs: number[], ys: number[], others: AABB[]): void {
    const eps = (GUIDE_SNAP_PX / state.camera.zoom) * 0.05;
    state.guides = [...alignGuides(box, xs, others, 'x', eps), ...alignGuides(box, ys, others, 'y', eps)];
  }

  /** Элементы, задетые рамкой (с достройкой до целых групп). */
  function marqueeIds(m: { x0: number; y0: number; x1: number; y1: number }): string[] {
    const s0x = Math.min(m.x0, m.x1) / state.camera.zoom + state.camera.x;
    const s0y = Math.min(m.y0, m.y1) / state.camera.zoom + state.camera.y;
    const s1x = Math.max(m.x0, m.x1) / state.camera.zoom + state.camera.x;
    const s1y = Math.max(m.y0, m.y1) / state.camera.zoom + state.camera.y;
    const rect = { x0: s0x, y0: s0y, x1: s1x, y1: s1y };
    return expandSelectionWithGroups(
      new Set(
        state.board.elements
          .filter(el => aabbIntersects(elementAABB(el), rect))
          .map(el => el.id),
      ),
    );
  }

  function finishMarquee(flash: boolean): void {
    const m = state.marquee;
    state.marquee = null;
    if (!m) { update(); return; }
    if (!flash) { setSelection(marqueeIds(m)); return; }
    flashIds(marqueeIds(m));
  }

  /** Подсветка указкой: выделение не трогаем, только мигаем контуром. */
  function flashIds(ids: string[]): void {
    if (ids.length) { state.flashes.push({ ids, t: performance.now() }); sendFlash(ids); }
    update();
  }

  /** start — цвет нового росчерка: след рвётся, а не тянется от предыдущего. */
  function addLaserPt(sx: number, sy: number, start?: string): void {
    const pts = state.laserPts;
    const last = pts[pts.length - 1];
    const t = performance.now();
    // слишком близкие точки только освежают голову следа
    if (!start && last && Math.hypot(last.x - sx, last.y - sy) < 1.5) { last.t = t; return; }
    pts.push({ x: sx, y: sy, t, ...(start ? { start } : {}) });
    if (pts.length > LASER_MAX_PTS) pts.splice(0, pts.length - LASER_MAX_PTS);
  }

  function extendFade(st: FadeStroke, pt: Pt): void {
    const last = st.pts[st.pts.length - 1];
    if (Math.hypot(pt.x - last.x, pt.y - last.y) * state.camera.zoom < 0.4) return;
    // то же сглаживание, что у пера
    st.pts.push({ x: last.x + (pt.x - last.x) * 0.6, y: last.y + (pt.y - last.y) * 0.6, p: pt.p });
  }

  function clearInkHold(a: Extract<Action, { kind: 'draw' }>): void {
    clearTimeout(a.hold?.timer);
    a.hold = undefined;
  }

  function trackInkHold(a: Extract<Action, { kind: 'draw' }>, pos: { x: number; y: number }, point: Pt): void {
    const hold = a.hold;
    if (!hold || state.liveStroke !== hold.stroke) return;
    const last = hold.points[hold.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) * state.camera.zoom >= INK_SAMPLE_STEP_PX) hold.points.push(point);
    if (Math.hypot(pos.x - hold.anchor.x, pos.y - hold.anchor.y) < INK_HOLD_SLOP_PX) return;

    hold.anchor = pos;
    clearTimeout(hold.timer);
    hold.timer = setTimeout(() => {
      if (action !== a || state.liveStroke !== hold.stroke || activeTool() !== 'pen' ||
          state.view !== 'board' || !canEditBoard()) return;
      const shape = recognizeInkShape(hold.points, state.camera.zoom);
      if (!shape) return;

      const { color, width, opacity } = hold.stroke;
      clearInkHold(a);
      // Действие продолжается до отпускания, но живого штриха больше нет.
      state.liveStroke = null;
      const target = { ...shape, id: uid(), color, width, ...opacityField(opacity) };
      addElement(target);
      animateInkRecognition(hold.stroke.pts, target);
    }, INK_HOLD_MS);
  }

  function finishAction(): void {
    stopAutoPan();
    const a = action;
    action = null;
    if (!a) return;
    if (transfer && a.kind === 'move') {
      clearTransfer(); state.attachmentPreview = null; state.liveEdit = false; state.guides = []; update(); return;
    }
    state.guides = [];
    switch (a.kind) {
      case 'draw':
        clearInkHold(a);
        if (state.liveStroke) endStroke();
        break;
      case 'erase':
        if (a.removed.length) pushHistory(a.pre);
        update();
        break;
      case 'erasePart':
        if (a.changed) pushHistory(a.pre);
        update();
        break;
      case 'shape': finishShape(); break;
      case 'solid': finishSolid(); break;
      case 'move':
        state.attachmentPreview = null;
        state.liveEdit = false;
        if (a.moved) {
          // Перенесли сам объект — его основа пересчитывается по новому месту.
          // Привязанные к нему элементы ехали вместе с ним и связь сохраняют.
          const next = reattachMoved(state.selection, state.board.elements, new Set(a.orig.keys()));
          if (next !== state.board.elements) replaceElements(next);
          pushHistory(a.pre);
        } else if (a.deselectOnUp) setSelection([]);
        update();
        break;
      case 'handle':
        state.liveEdit = false;
        if (a.changed) pushHistory(a.pre);
        update();
        break;
      case 'scale':
        state.liveEdit = false;
        if (a.changed) pushHistory(a.pre);
        update();
        break;
      case 'marquee': finishMarquee(!!a.flash); break;
      case 'laser':
        state.laserDown = false; // кнопку отпустили — след гаснет, голова остаётся курсором
        sendLaser([], state.style.color, true);
        update();
        break;
      case 'fade':
        setFadeStrokeEnd(undefined, performance.now());
        sendFadeStroke(a.sid, a.stroke, [], true);
        update();
        break;
      case 'click': beginTextEdit({ at: { x: a.x, y: a.y }, target: a.target }); break;
      case 'spread':
        state.spread = null;
        if (a.dy > 0 && a.ids.size) pushHistory(a.pre);
        update();
        break;
      case 'pan':
        canvas.style.cursor = cursorFor(activeTool());
        startPanGlide();
        update();
        break;
    }
  }

  function onPointerDown(e: PointerEvent): void {
    canvas.setPointerCapture(e.pointerId);
    if (e.pointerType !== 'mouse') {
      // палец и перо: после pointerup браузер шлёт эмулированный mousedown, и он снимал фокус
      // с только что открытого редактора стикера (касание — в центре стикера, мимо поля ввода).
      // Отменённый pointerdown гасит эмулированные события мыши; фокус с полей, который раньше
      // снимал тот mousedown, снимаем сами — как при клике мышью
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    const lp = localPos(e);
    pointers.set(e.pointerId, { x: lp.x, y: lp.y, type: e.pointerType });
    // открытый редактор текста фиксируем до разбора нажатия: перенос и ручки должны видеть новый текст
    closeEditor(true);


    // совместный режим: на странице без права edit правки запрещены
    if (!canEditBoard() && !(activeTool() === 'comment' && canAnnotate()) && activeTool() !== 'pan' && !POINTER_TOOLS.has(activeTool()) && e.button !== 1) {
      // читатель может выделить объект — для реакций и копирования, — если автор копировать не запретил
      if (activeTool() === 'select' && e.button === 0 && state.linkMode === null && canCopyCurrentBoard()) {
        const at = toScene(lp.x, lp.y);
        const picked = topHit(at.x, at.y);
        setSelection(picked ? expandSelectionWithGroups(new Set([picked.id])) : []);
      }
      return;
    }


    const touches = touchPtrs();
    if (e.pointerType === 'touch' && touches.length === 2) {
      // жест двумя пальцами прерывает текущее действие; начатое первым пальцем рисование —
      // это не штрих, а начало жеста: отбрасываем, а не сохраняем точкой на доске
      if (action?.kind === 'draw') { clearInkHold(action); action = null; state.liveStroke = null; }
      else if (action?.kind === 'shape') { action = null; state.liveShape = null; }
      else if (action?.kind === 'solid') { action = null; state.liveSolid = null; }
      else if (action?.kind === 'spread') { replaceElements(action.pre); action = null; state.spread = null; }
      finishAction();
      const [a, b] = touches;
      gesture = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
        cam: { ...state.camera },
      };
      return;
    }
    if (gesture || action || (touchBlocked && e.pointerType === 'touch')) return;

    if (e.button === 1 || activeTool() === 'pan') {
      e.preventDefault();
      panSamples = [];
      action = { pid: e.pointerId, kind: 'pan', sx: lp.x, sy: lp.y, cam: { ...state.camera } };
      canvas.style.cursor = 'grabbing';
      return;
    }
    const temporaryEraser = e.pointerType === 'mouse' && e.button === 2
      && (activeTool() === 'pen' || activeTool() === 'highlighter');
    if (e.button !== 0 && !temporaryEraser) return;

    const s = toScene(lp.x, lp.y);
    const tool = temporaryEraser ? 'partEraser' : activeTool();
    switch (tool) {
      case 'comment':
        if (canAnnotate()) action = { pid: e.pointerId, kind: 'comment', sx: lp.x, sy: lp.y, point: s, targetId: topHit(s.x, s.y)?.id };
        break;
      case 'pen':
      case 'highlighter': {
        const point = { x: s.x, y: s.y, p: pressureOf(e) };
        beginStroke(tool, point);
        const stroke = state.liveStroke;
        const hold = tool === 'pen' && stroke ? { stroke, points: [point], anchor: lp } : undefined;
        action = { pid: e.pointerId, kind: 'draw', hold };
        break;
      }
      case 'eraser': {
        const a: Extract<Action, { kind: 'erase' }> = { pid: e.pointerId, kind: 'erase', pre: state.board.elements, removed: [], skipped: new Set(), last: null };
        action = a;
        eraseAt(s.x, s.y, a);
        break;
      }
      case 'partEraser': {
        const a: Extract<Action, { kind: 'erasePart' }> = { pid: e.pointerId, kind: 'erasePart', pre: state.board.elements, changed: false, skipped: new Set(), last: null };
        action = a;
        erasePartAt(s.x, s.y, a);
        break;
      }
      case 'rect':
      case 'ellipse':
      case 'triangle':
      case 'line':
      case 'arrow':
        state.liveShape = {
          shape: tool, ax0: s.x, ay0: s.y, x0: s.x, y0: s.y, x1: s.x, y1: s.y,
          color: state.style.color, width: state.style.width * 1.3, ...opacityField(state.style.opacity),
        };
        action = { pid: e.pointerId, kind: 'shape' };
        update();
        break;
      case 'cube':
      case 'box':
      case 'prism':
      case 'pyramid':
      case 'truncPyramid':
      case 'cylinder':
      case 'cone':
      case 'truncCone':
      case 'sphere':
        // толщина без множителя: тело сразу выделяется и его толщина становится текущей
        state.liveSolid = {
          solid: tool, ax0: s.x, ay0: s.y, x0: s.x, y0: s.y, x1: s.x, y1: s.y,
          color: state.style.color, width: state.style.width, ...opacityField(state.style.opacity),
        };
        action = { pid: e.pointerId, kind: 'solid' };
        update();
        break;
      case 'select': {
        // общая рамка нескольких выделенных: тянем за её ручки — меняется размер всех
        const frame = selectionFrame();
        if (frame) {
          const r = HANDLE_HIT_PX / state.camera.zoom;
          for (const hp of frame.handles) {
            if (hp.h.kind !== 'resize' || Math.hypot(hp.x - s.x, hp.y - s.y) > r) continue;
            // прикреплённые к выделенному элементы меняются вместе с ним, как при переносе
            const orig = new Map<string, Element>();
            for (const id of withAttached(state.selection, state.board.elements)) {
              const el = state.board.elements.find(x => x.id === id);
              if (el) orig.set(id, el);
            }
            action = {
              pid: e.pointerId, kind: 'scale', pre: state.board.elements, orig, box: frame.box, h: hp.h,
              changed: false, others: guideTargets(new Set(orig.keys())),
            };
            state.liveEdit = true;
            return;
          }
        }
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
                  action = {
                    pid: e.pointerId, kind: 'handle', el: withNode, h: { kind: 'node', i: hp.h.i + 1 }, pre, changed: false,
                    others: guideTargets(new Set([sel.id])),
                  };
                  return;
                }
                action = {
                  pid: e.pointerId, kind: 'handle', el: sel, h: hp.h, pre: state.board.elements, changed: false,
                  others: guideTargets(new Set([sel.id])),
                };
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
        const hit = topHit(s.x, s.y, true);
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
          // страница на холсте: клик переходит на неё, перетаскивание двигает (и выделяет — для ручек)
          const link = !e.shiftKey && hit.type === 'image' && hit.page ? hit : null;
          startMove(e, s, wasSelected && !link, link);
        } else {
          // У нескольких выделенных перенос начинается и с пустого места внутри общей рамки
          // (в т. ч. между объектами): рамку берём как на экране — с тем же отступом в 4 px.
          const box = !e.shiftKey && state.selection.size > 1 ? selectionBox() : null;
          const pad = 4 / state.camera.zoom;
          if (box && s.x >= box.x0 - pad && s.x <= box.x1 + pad && s.y >= box.y0 - pad && s.y <= box.y1 + pad) {
            startMove(e, s, false, null);
            break;
          }
          if (!e.shiftKey) setSelection([]);
          action = { pid: e.pointerId, kind: 'marquee' };
          state.marquee = { x0: lp.x, y0: lp.y, x1: lp.x, y1: lp.y };
          update();
        }
        break;
      }
      case 'spread':
        // что поедет вниз, решаем один раз — по линии нажатия
        action = { pid: e.pointerId, kind: 'spread', pre: state.board.elements, ids: new Set([...spreadTargets(state.board.elements, s.y)].filter(id => { const el = state.board.elements.find(x => x.id === id); return !el || canTouchElement(el); })), y: s.y, dy: 0 };
        state.spread = { y: s.y, dy: 0 };
        update();
        break;
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
      case 'laser': {
        // след — только пока кнопка зажата; цвет закрепляется за росчерком
        const color = state.style.color;
        state.laserDown = true;
        action = { pid: e.pointerId, kind: 'laser' };
        addLaserPt(lp.x, lp.y, color);
        sendLaser([{ x: s.x, y: s.y, p: 0.5 }], color, false);
        update();
        break;
      }
      case 'fadePen': {
        // толщина как у маркера (см. endStroke)
        const stroke: FadeStroke = {
          color: state.style.color, width: state.style.width * 3.2, ...opacityField(state.style.opacity),
          pts: [{ x: s.x, y: s.y, p: pressureOf(e) }], endT: null,
        };
        setFadeStrokeEnd(undefined, null);
        state.fadeStrokes.push(stroke);
        const sid = uid();
        action = { pid: e.pointerId, kind: 'fade', stroke, sid };
        sendFadeStroke(sid, stroke, [{ x: s.x, y: s.y, p: pressureOf(e) }], false);
        update();
        break;
      }
      case 'flash': {
        const hit = topHit(s.x, s.y);
        if (hit) { flashIds(expandSelectionWithGroups(new Set([hit.id]))); break; }
        // мимо объектов — рамка, как у выделения
        action = { pid: e.pointerId, kind: 'marquee', flash: true };
        state.marquee = { x0: lp.x, y0: lp.y, x1: lp.x, y1: lp.y };
        update();
        break;
      }
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
    stopFollowByUser();
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
    // размер ластика для пера и маркера растёт со скоростью руки
    if (state.tool === 'partEraser' || action?.kind === 'erasePart') trackEraser(lp.x, lp.y);
    // шлейф или искры Pro-курсора (только мышь и только у «Выделения», где виден персональный курсор)
    if (e.pointerType === 'mouse' && state.tool === 'select' && !spacePan) fxMove('me', lp.x, lp.y, myCursorId());
    if (!action && e.pointerType !== 'touch') { const sp = toScene(lp.x, lp.y); hoverForeign(sp.x, sp.y); }
    if (collabActive()) noteCursor(lp.x / state.camera.zoom + state.camera.x, lp.y / state.camera.zoom + state.camera.y);
    if (state.tool === 'comment') {
      const pt = toScene(lp.x, lp.y);
      const id = !spacePan && !gesture && !action && e.pointerType !== 'touch' && canAnnotate() ? topHit(pt.x, pt.y)?.id ?? null : null;
      if (id !== state.commentHoverId) {
        state.commentHoverId = id;
        requestRender();
      }
    }
    if (state.tool === 'partEraser') update(); // кружок ластика под курсором
    else if (state.tool === 'spread' || presenting()) requestRender(); // линия разреза под курсором, курсор в окне демонстрации

    if (gesture) { applyGesture(); return; }
    if (touchBlocked && e.pointerType === 'touch') return;
    if (state.tool === 'laser' && action?.kind !== 'laser') update(); // голова указки следует за курсором
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
        // своё перемещение по холсту выключает «Следить за участником»
        if (lp.x !== a.sx || lp.y !== a.sy) stopFollowByUser();
        panSamples.push({ t: performance.now(), x: lp.x, y: lp.y });
        if (panSamples.length > 12) panSamples.shift();
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
          const point = { x: s.x, y: s.y, p: pressureOf(ev) };
          trackInkHold(a, c, point);
          extendStroke(point);
        }
        break;
      case 'laser': {
        const out: Pt[] = [];
        for (const ev of coalesced(e)) {
          const c = localPos(ev);
          addLaserPt(c.x, c.y);
          const s = toScene(c.x, c.y);
          out.push({ x: s.x, y: s.y, p: 0.5 });
        }
        sendLaser(out, state.style.color, false);
        update();
        break;
      }
      case 'fade': {
        const before = a.stroke.pts.length;
        for (const ev of coalesced(e)) {
          const c = localPos(ev);
          const s = toScene(c.x, c.y);
          extendFade(a.stroke, { x: s.x, y: s.y, p: pressureOf(ev) });
        }
        if (a.stroke.pts.length > before) sendFadeStroke(a.sid, a.stroke, a.stroke.pts.slice(before), false);
        update();
        break;
      }
      case 'erase':
        for (const ev of coalesced(e)) {
          const c = localPos(ev);
          const s = toScene(c.x, c.y);
          eraseAt(s.x, s.y, a);
        }
        break;
      case 'erasePart':
        for (const ev of coalesced(e)) {
          const c = localPos(ev);
          const s = toScene(c.x, c.y);
          erasePartAt(s.x, s.y, a);
        }
        break;
      case 'shape':
      case 'solid': {
        const s = toScene(lp.x, lp.y);
        const ls = a.kind === 'shape' ? state.liveShape : state.liveSolid;
        if (ls) {
          const isLine = 'shape' in ls && (ls.shape === 'line' || ls.shape === 'arrow');
          // модификаторы как при resize: Alt — от центра, Shift/Ctrl — пропорции/45°;
          // куб и шар всегда вписываются в квадрат
          let dx = s.x - ls.ax0, dy = s.y - ls.ay0;
          const square = e.shiftKey || e.ctrlKey || e.metaKey || ('solid' in ls && solidKeepsAspect(ls.solid));
          if (square) {
            if (!isLine) {
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
        // направляющие: у ручки размера неповёрнутого элемента — по краю, который тянут; у конца линии и узла — по точке
        const h = a.h;
        const rotated = (a.el.type === 'shape' || a.el.type === 'image') && !!a.el.rot;
        const guided = a.others && (h.kind === 'end' || h.kind === 'node' || (h.kind === 'resize' && !rotated)) ? a.others : null;
        const gx = guided !== null && (h.kind !== 'resize' || h.dx !== 0);
        const gy = guided !== null && (h.kind !== 'resize' || h.dy !== 0);
        if (guided) {
          const tol = GUIDE_SNAP_PX / state.camera.zoom;
          const sx = gx ? alignShift([snapped.x], guided, 'x', tol) : null;
          const sy = gy ? alignShift([snapped.y], guided, 'y', tol) : null;
          if (sx !== null) snapped.x += sx;
          if (sy !== null) snapped.y += sy;
        }
        // картинки по настройке всегда пропорциональны: Shift и Ctrl не нужны
        const proportional = e.shiftKey || e.ctrlKey || e.metaKey || (a.el.type === 'image' && state.settings.keepImageAspect);
        const next = applyHandle(a.el, a.h, snapped, { proportional, fromCenter: e.altKey, rotateStep: e.shiftKey }, rotateAngle);
        if (guided) {
          const pt = { x0: snapped.x, y0: snapped.y, x1: snapped.x, y1: snapped.y };
          const box = h.kind === 'resize' ? elementAABB(next) : pt;
          // у ручки размера — край со стороны ручки (от центра — оба края)
          const edges = (lo: number, hi: number, d: number) => (e.altKey ? [lo, hi] : d > 0 ? [hi] : [lo]);
          const xs = !gx ? [] : h.kind === 'resize' ? edges(box.x0, box.x1, h.dx) : [snapped.x];
          const ys = !gy ? [] : h.kind === 'resize' ? edges(box.y0, box.y1, h.dy) : [snapped.y];
          showGuides(box, xs, ys, guided);
        }
        replaceElements(state.board.elements.map(x => (x.id === a.el.id ? next : x)));
        a.changed = true;
        break;
      }
      case 'scale': {
        const s = toScene(lp.x, lp.y);
        const step = snapStepNow();
        let pt = { x: snapValue(s.x, step), y: snapValue(s.y, step), p: s.p };
        const guided = a.others;
        if (guided) {
          // тянемый край рамки примагничиваем к опорным линиям соседей
          const tol = GUIDE_SNAP_PX / state.camera.zoom;
          const gx = a.h.dx !== 0 ? alignShift([pt.x], guided, 'x', tol) : null;
          const gy = a.h.dy !== 0 ? alignShift([pt.y], guided, 'y', tol) : null;
          if (gx !== null) pt = { ...pt, x: pt.x + gx };
          if (gy !== null) pt = { ...pt, y: pt.y + gy };
        }
        const box = resizeBox(a.box, a.h, pt, { proportional: e.shiftKey || e.ctrlKey || e.metaKey, fromCenter: e.altKey });
        if (guided) {
          const xs = a.h.dx === 0 ? [] : e.altKey ? [box.x0, box.x1] : [a.h.dx > 0 ? box.x1 : box.x0];
          const ys = a.h.dy === 0 ? [] : e.altKey ? [box.y0, box.y1] : [a.h.dy > 0 ? box.y1 : box.y0];
          showGuides(box, xs, ys, guided);
        }
        replaceElements(state.board.elements.map(el => (a.orig.has(el.id) ? scaleElement(a.orig.get(el.id)!, a.box, box) : el)));
        a.changed = true;
        break;
      }
      case 'move': {
        if ((a.moved || Math.hypot(lp.x/state.camera.zoom + state.camera.x-a.start.x,lp.y/state.camera.zoom + state.camera.y-a.start.y)*state.camera.zoom >= MOVE_THRESHOLD_PX) && updateTransfer(e,a)) { a.moved=true; stopAutoPan(); break; }
        const s = toScene(lp.x, lp.y);
        let dx = s.x - a.start.x;
        let dy = s.y - a.start.y;
        if (!a.moved && Math.hypot(dx, dy) * state.camera.zoom < MOVE_THRESHOLD_PX) break;
        if (!a.moved && (a.duplicate || (e.altKey && canCopyCurrentBoard()))) {
          const sources = a.pre.filter(el => a.orig.has(el.id));
          const ids = new Map(sources.map(el => [el.id, uid()]));
          const groupIds = new Map<string, string>();
          const copies = sources.map(el => {
            const copy = { ...structuredClone(el), id: ids.get(el.id)! };
            if (copy.groupId) {
              if (!groupIds.has(copy.groupId)) groupIds.set(copy.groupId, uid());
              copy.groupId = groupIds.get(copy.groupId)!;
            }
            return rebindAttachment(copy, ids);
          });
          a.orig = new Map(copies.map(el => [el.id, el]));
          state.board.elements = [...a.pre, ...copies];
          state.selection = new Set(copies.map(el => el.id));
          a.others = guideTargets(state.selection);
          a.box = a.others && copies.length ? copies.map(elementAABB).reduce(aabbUnion) : null;
          a.link = null;
        }
        a.moved = true;
        // зажатый Ctrl (Cmd) временно отключает привязку к сетке и направляющие — как в Figma и Miro
        const free = e.ctrlKey || e.metaKey;
        const step = free ? 0 : snapStepNow();
        if (step > 0 && a.orig.size > 0) {
          // дельта привязки считается по опорному элементу, взаимное расположение сохраняется
          const ref = a.orig.values().next().value as Element;
          const rx = ref.type === 'stroke' || ref.type === 'poly' ? ref.pts[0].x : ref.x;
          const ry = ref.type === 'stroke' || ref.type === 'poly' ? ref.pts[0].y : ref.y;
          dx = snapValue(rx + dx, step) - rx;
          dy = snapValue(ry + dy, step) - ry;
        }
        if (free) state.guides = [];
        else if (a.box && a.others) {
          // край или центр рядом с краем или центром соседа — примагничиваем (важнее сетки) и показываем линию
          const tol = GUIDE_SNAP_PX / state.camera.zoom;
          const shifted = (b: AABB) => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
          const sx = alignShift(boxAnchors(shifted(a.box), 'x'), a.others, 'x', tol);
          const sy = alignShift(boxAnchors(shifted(a.box), 'y'), a.others, 'y', tol);
          if (sx !== null) dx += sx;
          if (sy !== null) dy += sy;
          const box = shifted(a.box);
          showGuides(box, boxAnchors(box, 'x'), boxAnchors(box, 'y'), a.others);
        }
        const moved = state.board.elements.map(el => (a.orig.has(el.id) ? translateElement(a.orig.get(el.id)!, dx, dy) : el));
        // Основа, едущая вместе с элементом, связь сохраняет — новую не ищем.
        const movingIds = new Set(a.orig.keys());
        const previews: { item: string; base: string }[] = [];
        for (const el of moved) {
          if (!state.selection.has(el.id)) continue;
          if ((el.type !== 'stroke' && el.type !== 'note') || (el.baseId && movingIds.has(el.baseId))) continue;
          const base = geometricFoundationFor(el, moved, movingIds);
          if (base) previews.push({ item: el.id, base: base.id });
        }
        state.attachmentPreview = previews;
        replaceElements(moved);
        updateAutoPan(e);
        break;
      }
      case 'marquee':
        if (state.marquee) { state.marquee.x1 = lp.x; state.marquee.y1 = lp.y; }
        update();
        break;
      case 'spread': {
        // только вниз: место освобождают, а не сжимают
        const step = snapStepNow();
        const dy = snapValue(Math.max(0, toScene(lp.x, lp.y).y - a.y), step);
        if (dy !== a.dy) {
          a.dy = dy;
          state.spread = { y: a.y, dy };
          if (a.ids.size) replaceElements(spreadElements(a.pre, a.ids, dy));
          else update();
        }
        updateAutoPan(e);
        break;
      }
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (action?.pid === e.pointerId) stopAutoPan();
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
    const a = action;
    if (a?.kind === 'comment') {
      action = null;
      const lp = localPos(e);
      if (e.type !== 'pointerup' || activeTool() !== 'comment' || Math.hypot(lp.x - a.sx, lp.y - a.sy) > MOVE_THRESHOLD_PX) return;
      const target = a.targetId ? state.board.elements.find(el => el.id === a.targetId) : null;
      if (target !== undefined) commentAt(a.point, target);
      return;
    }
    if (transfer && a?.kind === 'move') {
      const tr=transfer;
      if (tr.transition) { void tr.transition.then(() => { if (transfer === tr && action === a) onPointerUp(e); }); return; }
      if (e.type !== 'pointercancel') {
        const p=toScene(localPos(e).x,localPos(e).y);
        const bounds=tr.source.map(elementAABB).reduce(aabbUnion);
        const dx=p.x-(bounds.x0+bounds.x1)/2, dy=p.y-(bounds.y0+bounds.y1)/2;
        const copy=tr.copy || (e.altKey && canCopyCurrentBoard());
        if (state.pageId===tr.sourceId && !copy) {
          pushHistory(tr.original);
          const ids=new Set(tr.source.map(el=>el.id));
          replaceElements(tr.original.map(el=>ids.has(el.id)?translateElement(el,dx,dy):el));
          setSelection([...ids]);
        } else {
          if (!copy) {
            const ids=new Set(tr.source.map(el=>el.id));
            tr.sourcePage.elements=tr.original.filter(el=>!ids.has(el.id));
            // из настоящей страницы в черновик: правка черновика проект не помечает, а страница потеряла объекты
            if (!isDraftId(tr.sourceId)) touchProject();
          }
          insertCopies(tr.source,dx,dy);
        }
      }
      clearTransfer(); action=null; state.liveEdit=false; state.guides=[]; update(true);
      return;
    }
    finishAction();
    if (a?.kind === 'move' && !a.moved && a.link) openPageLink(a.link);
  }

  function onPointerLeave(): void {
    state.hover = null;
    if (state.commentHoverId !== null) {
      state.commentHoverId = null;
      requestRender();
    }
    resetEraser();
    fxForget('me');
    if (state.tool === 'partEraser' || state.tool === 'laser' || state.tool === 'spread') update();
    else if (presenting()) requestRender();
  }

  function onDblClick(e: MouseEvent): void {
    if (!canEditBoard()) return;
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
    const any = topHit(s.x, s.y);
    if (any && any.type === 'task') { editTaskElement(any); return; }
    // чужую надпись при защите не открыть на правку (SPEC_NIGHT6 §4.6)
    const hit = topHit(s.x, s.y, true);
    if (hit && (hit.type === 'text' || hit.type === 'note')) beginTextEdit({ el: hit });
    // надпись фигуры: двойной клик (на планшете — двойное касание) сразу открывает редактор и клавиатуру
    else if (shapeHoldsText(hit) && canEditBoard()) {
      if (!state.selection.has(hit.id) || state.selection.size !== 1) setSelection([hit.id]);
      beginTextEdit({ el: hit });
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    stopFollowByUser();
    const lp = localPos(e);
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    // WheelEvent не позволяет надёжно отличить мышь от тачпада.
    const zoomMode = state.settings.wheelMode === 'zoom';
    // pinch жест точпада приходит как ctrl+wheel — это всегда масштаб;
    // в режиме «как в Figma» Ctrl+Shift прокручивает по вертикали
    const panVertical = zoomMode && e.ctrlKey && e.shiftKey;
    const zoom = !panVertical && (e.ctrlKey || (zoomMode && !e.shiftKey && e.deltaY !== 0));
    if (zoom) {
      zoomAtScreen(lp.x, lp.y, Math.exp(-e.deltaY * k * 0.0022));
    } else {
      let dx = e.deltaX * k;
      let dy = e.deltaY * k;
      if (e.shiftKey && !panVertical && dx === 0) { dx = dy; dy = 0; }
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

  // ----- Перенос выделенного стрелками -----

  /** Удержанные стрелки и идущий перенос: одно нажатие или удержание (с отпусканием всех стрелок) — один шаг истории. */
  const heldArrows = new Set<string>();
  let nudge: { pre: Element[]; moved: boolean; holdAt: number; last: number; raf: number; fast: boolean } | null = null;

  function nudgeBy(dx: number, dy: number): void {
    if (!nudge || (dx === 0 && dy === 0)) return;
    nudge.moved = true;
    const moving = withAttached(state.selection, state.board.elements);
    replaceElements(state.board.elements.map(el => (moving.has(el.id) ? translateElement(el, dx, dy) : el)));
  }

  function nudgeTick(t: number): void {
    if (!nudge) return;
    if (state.selection.size === 0 || action) { endNudge(); return; }
    const dt = Math.min(t - nudge.last, 50) / 1000;
    nudge.last = t;
    if (t >= nudge.holdAt) {
      const dir = arrowDirection(heldArrows);
      const v = NUDGE_SPEED * (nudge.fast ? NUDGE_FAST : 1) / state.camera.zoom * dt;
      nudgeBy(dir.x * v, dir.y * v);
    }
    nudge.raf = requestAnimationFrame(nudgeTick);
  }

  function endNudge(): void {
    const n = nudge;
    nudge = null;
    heldArrows.clear();
    if (!n) return;
    cancelAnimationFrame(n.raf);
    if (n.moved) {
      // Стрелки двигают объект так же, как мышь: основа пересчитывается по новому месту.
      const next = reattachMoved(state.selection, state.board.elements, withAttached(state.selection, state.board.elements));
      if (next !== state.board.elements) replaceElements(next);
      pushHistory(n.pre);
    }
    update();
  }

  function onArrowDown(e: KeyboardEvent): void {
    if (state.selection.size === 0 || action || !canEditBoard()) return;
    e.preventDefault();
    if (e.repeat && heldArrows.has(e.code)) return; // удержание ведёт своя анимация, а не автоповтор системы
    const now = performance.now();
    if (!nudge) {
      nudge = { pre: state.board.elements, moved: false, holdAt: now + NUDGE_HOLD_MS, last: now, raf: 0, fast: e.shiftKey };
      nudge.raf = requestAnimationFrame(nudgeTick);
    }
    nudge.fast = e.shiftKey;
    heldArrows.add(e.code);
    // нажатие — один шаг (по сетке, если включена привязка); дальше, если не отпускать, поедет плавно
    if (now < nudge.holdAt) {
      const grid = state.settings.snapToGrid ? gridStepFor(state.camera.zoom) : 0;
      const step = grid > 0 ? grid * (e.shiftKey ? 5 : 1) : e.shiftKey ? NUDGE_STEP_FAST : NUDGE_STEP;
      const d = arrowStep(e.code, step);
      nudgeBy(d.x, d.y);
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (isTypingTarget(e.target)) return;
    if ((e.code === 'PageUp' || e.code === 'PageDown') && !e.ctrlKey && !e.metaKey && !e.altKey && state.selection.size && canEditBoard()) {
      e.preventDefault();
      if (e.shiftKey) { if (e.code === 'PageUp') bringForward(); else sendBackward(); }
      else moveSelectionLayer(e.code === 'PageUp' ? state.board.elements.length : 0);
      return;
    }
    if (nudge) {
      if (e.ctrlKey || e.metaKey || e.altKey) endNudge(); // Ctrl+Z и другие сочетания не должны застать перенос на полпути
      else if (e.key === 'Shift') nudge.fast = true;
    }
    if (isArrowKey(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) { onArrowDown(e); return; }
    // выделена фигура с текстовым курсором: печатные символы — её надпись (как в Miro), а не горячие клавиши
    const captioned = selectedTextShape();
    if (captioned && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // пробел оставляем панораме, + и − — масштабу: надпись с них не начинается
      if (e.key.length === 1 && e.key !== ' ' && !ZOOM_KEYS.has(e.code)) {
        e.preventDefault();
        beginTextEdit({ el: captioned, append: e.key });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        beginTextEdit({ el: captioned });
        return;
      }
      // у курсора в надписи Backspace стирает её последний символ, а не фигуру;
      // у пустой фигуры стирать нечего — Backspace, как и Delete, удаляет её
      if (e.code === 'Backspace' && !e.shiftKey && captioned.text) {
        e.preventDefault();
        beginTextEdit({ el: captioned, backspace: true });
        return;
      }
    }
    // страницы: переход Ctrl/Alt + номер и новая страница — сочетания из «Горячих клавиш»
    const pageNo = pageNumberFromEvent(e, state.settings.pageKeyMod);
    if (pageNo) { e.preventDefault(); switchToPage(pageNo); return; }
    if (state.settings.newPageKey && comboFromEvent(e) === state.settings.newPageKey) {
      e.preventDefault();
      if (!e.repeat) addPageFromKey(); // зажатая клавиша не плодит страницы
      return;
    }
    if (comboFromEvent(e) === DRAFT_KEY) {
      e.preventDefault();
      if (!e.repeat) addDraftFromKey();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      switch (e.code) {
        case 'KeyZ': e.preventDefault(); if (!canEditBoard()) return; if (e.shiftKey) redo(); else undo(); return;
        case 'KeyY': e.preventDefault(); if (canEditBoard()) redo(); return;
        case 'KeyS': e.preventDefault(); void saveNow(); return;
        case 'KeyG':
          e.preventDefault();
          if (!canEditBoard()) return;
          if (e.shiftKey) ungroupSelected(); else groupSelected();
          return;
        case 'KeyE': e.preventDefault(); void exportPng(); return;
        case 'KeyC':
          if (e.shiftKey && state.selection.size) { e.preventDefault(); void copySelectionAsImage(); }
          return;
        // начертание выделенного текста и надписей фигур (в редакторе текста — там же, см. app.ts)
        case 'KeyB':
        case 'KeyI':
          if (e.shiftKey || !canEditBoard()) return;
          e.preventDefault();
          toggleTextFlag(e.code === 'KeyB' ? 'bold' : 'italic');
          return;
        // Ctrl+C / Ctrl+X / Ctrl+V — события copy/cut/paste (см. app.ts): так работает и системный буфер
        case 'KeyD': e.preventDefault(); duplicateSelection(); return;
        case 'KeyA':
          e.preventDefault();
          // без права правки выделять нечего: выделенное можно было бы удалить
          if (canEditBoard()) selectAll();
          return;
        case 'Comma': e.preventDefault(); openAllSettings(); return;
      }
      return;
    }
    // режим разработки: «+» и «−» переключают тариф по лестнице Free → Pro → Tutor (и обратно) вместо масштаба;
    // тариф в шапке показывает превращение, бейджи Pro раскалываются, когда их увидят
    if (!e.altKey && devModeEnabled()) {
      const plan = devPlanStep(e.code, userPlan());
      if (plan) {
        e.preventDefault();
        // Free без лимитов ничем не отличается от Pro — поэтому на Free лимиты включаются
        if (plan === 'free') setLimitsEnforced(true);
        setUserPlan(plan);
        showToast(`Тариф: ${PLAN_TITLES[plan]} (режим разработки)`
          + (limitsEnforced() ? ' · лимиты включены' : ' · лимиты выключены'));
        return;
      }
    }
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!spacePan) { spacePan = true; canvas.style.cursor = 'grab'; }
        break;
      case 'Escape':
        if (state.livePoly) { state.livePoly = null; update(); break; }
        // без начатого действия Esc снимает выделение
        if (!action && state.selection.size > 0) { setSelection([]); break; }
        finishAction();
        break;
      case 'Enter':
        if (state.livePoly) commitPoly(false);
        break;
      case 'Delete':
      case 'Backspace': e.preventDefault(); if (canEditBoard()) deleteSelected(); break;
      case 'Equal': stopFollowByUser(); zoomAtCenter(1.25); break;
      case 'Minus': stopFollowByUser(); zoomAtCenter(1 / 1.25); break;
      case 'Digit0': stopFollowByUser(); fitContent(true); break;
      case 'KeyB': togglePages(); break;
      default: {
        // клавиши инструментов настраиваются в окне «Все настройки»
        const tool = toolByKey(e.code);
        if (tool) pickTool(tool);
      }
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (nudge) {
      if (isArrowKey(e.code)) {
        heldArrows.delete(e.code);
        if (heldArrows.size === 0) endNudge();
      } else if (e.key === 'Shift') nudge.fast = false;
    }
    if (e.code === 'Space') {
      spacePan = false;
      canvas.style.cursor = cursorFor(state.tool);
    }
  }

  // Отменяем события боковых кнопок до браузерной навигации. Колёсико
  // перехватываем только при явном назначении, иначе оно двигает доску.
  function mouseAction(e: MouseEvent): { action: string } | null {
    if (isNativeApp() || state.view !== 'board' || settingsDialogOpen() || isTypingTarget(e.target)) return null;
    if (e.button !== 1 && e.button !== 3 && e.button !== 4) return null;
    const id = String(e.button) as '1' | '3' | '4';
    if (e.button === 1) return state.settings.mouseBindings['1'];
    if (state.settings.mouseMode === 'custom') return state.settings.mouseBindings[id] ?? { action: '' };
    return { action: state.settings.mouseMode === 'pages' ? (e.button === 3 ? 'page:previous' : 'page:next') : (e.button === 3 ? 'key:Ctrl+KeyZ' : 'key:Ctrl+KeyY') };
  }
  window.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') return;
    const binding = mouseAction(e);
    if (!binding) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const a = binding.action;
    if (a === 'page:new') {
      addPageFromKey();
    } else if (a.startsWith('page:')) {
      const index = state.project.pages.findIndex(page => page.id === state.pageId);
      const count = state.project.pages.length;
      if (count && index >= 0) {
        const target = (index + (a === 'page:previous' ? -1 : 1) + count) % count;
        if (target !== index) switchToPage(target + 1);
      }
    } else if (a.startsWith('tool:')) {
      const id = a.slice(5);
      if (TOOL_DEFS.some(def => def.id === id)) pickTool(id as ToolId);
    } else if (a.startsWith('key:')) {
      const parts = a.slice(4).split('+');
      const code = parts.pop()!;
      const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code;
      const init = { code, key, ctrlKey: parts.includes('Ctrl'), shiftKey: parts.includes('Shift'), altKey: parts.includes('Alt'), bubbles: true, cancelable: true };
      onKeyDown(new KeyboardEvent('keydown', init));
      onKeyUp(new KeyboardEvent('keyup', init));
    }
  }, true);
  for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) window.addEventListener(type, e => {
    // У мыши pointerup приходит только после отпускания последней из зажатых кнопок.
    if (type === 'mouseup' && e.button === 0 && action?.kind === 'draw' && pointers.get(action.pid)?.type === 'mouse') {
      pointers.delete(action.pid);
      finishAction();
    }
    if (mouseAction(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // автор скрыл страницу под гостем (SPEC_NIGHT5 §7): незавершённый жест отменяется без записи в историю
  onCancelInteraction(() => {
    stopAutoPan();
    cancelCameraAnim();
    if (action?.kind === 'draw') clearInkHold(action);
    // содержимое страницы не трогаем: следом приходит проект хаба, а правка здесь ушла бы ему патчем
    action = null;
    gesture = null;
    pointers.clear();
    state.commentHoverId = null;
    touchBlocked = false;
    clearTransfer();
    state.liveStroke = null;
    state.liveShape = null;
    state.liveSolid = null;
    state.livePoly = null;
    state.liveNote = null;
    state.liveEdit = false;
    state.marquee = null;
    state.spread = null;
    state.guides = [];
    state.dragHidden = null;
    resetEraser();
    update();
  });
  addGestureProbe(() => (action !== null && action.kind !== 'pan' && action.kind !== 'marquee' && action.kind !== 'fade') || nudge !== null);
  // любой жест пользователя прерывает плавный перелёт камеры (SPEC_NIGHT5 §8)
  canvas.addEventListener('pointerdown', () => { cancelCameraAnim(); stopZoomGlide(); stopPanGlide(); }, { capture: true });
  canvas.addEventListener('wheel', () => { cancelCameraAnim(); stopPanGlide(); }, { capture: true, passive: true });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('lostpointercapture', e => {
    if ((action?.kind === 'draw' || action?.kind === 'comment') && action.pid === e.pointerId) onPointerUp(e);
  });
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (state.livePoly) commitPoly(false); // правая кнопка завершает открытую ломаную
  });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', endNudge); // стрелку отпустили в другом окне — keyup не придёт
  window.addEventListener('blur', stopAutoPan);
  window.addEventListener('blur', () => {
    if (action?.kind === 'draw') clearInkHold(action);
  });
}

function pressureOf(e: PointerEvent): number {
  if (e.pointerType === 'mouse') return 0.5;
  return e.pressure > 0 ? e.pressure : 0.5;
}
