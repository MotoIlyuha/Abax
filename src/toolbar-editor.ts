// Раздел «Панель инструментов» окна настроек: порядок кнопок перетаскиванием,
// именованные группы, скрытие с панели и горячие клавиши.
// Перетаскивание — на pointer-событиях: одинаково работает мышью, пером и пальцем.

import type { ToolId } from './types';
import type { SectionView } from './settings-dialog';
import {
  type EntryDrop, type EntryRef, type ToolbarConfig, type ToolbarGroup, type ToolbarList,
  GROUP_NAME_MAX, addGroup, combineTools, defaultToolbar, keyLabel, keyProblem, moveEntry, nextGroupName,
  renameGroup, setEntryHidden, setToolKey, setToolbarConfig, svg, toolDef, toolTip, toolbarConfig, ungroup,
} from './toolbar';

const ICONS = {
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  ungroup: svg('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M13 6h4M15 4v4M7 13v4M5 15h4"/>'),
};

const HINT = 'Перетащите инструмент на другой — получится группа. Клик по клавише — назначить новую.';
/** Доля высоты строки сверху и снизу, где бросок вставляет рядом, а не объединяет в группу. */
const EDGE = 0.3;
const DRAG_THRESHOLD = 4;
const GHOST_OFFSET = 12;
const SCROLL_ZONE = 36;

type MarkMode = 'before' | 'after' | 'into' | 'combine';
type Drop = EntryDrop | { combine: ToolId };
interface Hit { drop: Drop; el: HTMLElement; mode: MarkMode }

interface Drag {
  ref: EntryRef;
  source: HTMLElement;
  pointerId: number;
  /** Где нажали: перетаскивание начинается, когда указатель отойдёт на DRAG_THRESHOLD. */
  x0: number; y0: number;
  x: number; y: number;
  started: boolean;
  ghost: HTMLElement | null;
  hit: Hit | null;
  raf: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function iconButton(className: string, icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `tbe-btn ${className}`);
  b.innerHTML = icon;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function refOfEl(e: Element | null): EntryRef | null {
  if (!(e instanceof HTMLElement)) return null;
  if (e.dataset.tool) return { tool: e.dataset.tool as ToolId };
  if (e.dataset.group) return { group: e.dataset.group };
  return null;
}

export function renderToolbarEditor(host: HTMLElement): SectionView {
  const root = el('div', 'tbe');
  host.appendChild(root);
  let status = HINT;
  let statusError = false;
  /** Инструмент, которому сейчас назначают клавишу. */
  let capture: ToolId | null = null;
  let drag: Drag | null = null;
  /** Что сфокусировать после перерисовки (селектор внутри раздела). */
  let focusAfter: string | null = null;
  /** Группа, которую после перерисовки сразу переименовывают (только что созданная). */
  let renameAfter: string | null = null;
  /** Название группы в правке: поле стоит на месте текста. */
  let renaming: { groupId: string; input: HTMLInputElement; span: HTMLElement } | null = null;
  let indicator: HTMLElement | null = null;

  const commit = (next: ToolbarConfig) => {
    setToolbarConfig(next);
    draw();
  };

  function setStatus(text: string, error = false): void {
    status = text;
    statusError = error;
    const s = root.querySelector<HTMLElement>('.tbe-status');
    if (s) {
      s.textContent = text;
      s.classList.toggle('error', error);
    }
  }

  // ----- Отрисовка -----

  function draw(): void {
    finishRename(true);
    const scroll = [...root.querySelectorAll<HTMLElement>('.tbe-list')].map(l => l.scrollTop);
    root.textContent = '';
    const cfg = toolbarConfig();

    const top = el('div', 'tbe-top');
    top.appendChild(preview(cfg));
    const reset = el('button', 'sd-btn tbe-reset', 'Сбросить');
    reset.title = 'Вернуть панель и горячие клавиши как было по умолчанию';
    reset.addEventListener('click', () => {
      if (!confirm('Вернуть панель инструментов и горячие клавиши по умолчанию?')) return;
      setStatus('Панель инструментов сброшена');
      commit(defaultToolbar());
    });
    top.appendChild(reset);

    const cols = el('div', 'tbe-cols');
    cols.append(column(cfg, 'items'), column(cfg, 'hidden'));
    const st = el('div', 'tbe-status' + (statusError ? ' error' : ''), status);
    st.setAttribute('role', 'status');
    root.append(top, cols, st);

    root.querySelectorAll<HTMLElement>('.tbe-list').forEach((l, i) => { l.scrollTop = scroll[i] ?? 0; });
    if (focusAfter) {
      const f = root.querySelector<HTMLElement>(focusAfter);
      focusAfter = null;
      f?.focus();
    }
    if (renameAfter) {
      const id = renameAfter;
      renameAfter = null;
      root.querySelector(`[data-group="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      startRename(id);
    }
  }

  /** Так панель выглядит сейчас: кнопки по порядку, у групп — уголок. */
  function preview(cfg: ToolbarConfig): HTMLElement {
    const p = el('div', 'tbe-preview');
    p.setAttribute('aria-label', 'Предпросмотр панели инструментов');
    for (const it of cfg.items) {
      if (it.type === 'group' && it.tools.length === 0) continue;
      const b = el('span', 'tbe-pv-btn' + (it.type === 'group' ? ' group' : ''));
      b.innerHTML = toolDef(it.type === 'tool' ? it.id : it.tools[0]).icon;
      b.title = it.type === 'tool' ? toolTip(it.id) : `${it.name}: ${it.tools.map(t => toolDef(t).title).join(', ')}`;
      p.appendChild(b);
    }
    if (!p.childElementCount) p.appendChild(el('span', 'tbe-pv-empty', 'На панели только цвет и толщина'));
    const ind = el('span', 'tbe-pv-btn');
    ind.innerHTML = '<i class="style-ind"><b></b></i>';
    ind.title = 'Цвет и толщина';
    p.append(el('span', 'tbe-pv-sep'), ind);
    return p;
  }

  function column(cfg: ToolbarConfig, list: ToolbarList): HTMLElement {
    const items = cfg[list];
    const col = el('div', 'tbe-col');
    const head = el('div', 'tbe-col-head', list === 'items' ? 'На панели' : 'Скрытые');
    const n = items.reduce((s, it) => s + (it.type === 'tool' ? 1 : it.tools.length), 0);
    head.appendChild(el('span', 'tbe-count', String(n)));
    const box = el('div', 'tbe-list');
    box.dataset.list = list;
    for (const it of items) box.appendChild(it.type === 'tool' ? toolRow(cfg, it.id, list, true) : groupCard(cfg, it, list));
    if (items.length === 0) {
      box.appendChild(el('div', 'tbe-empty', list === 'items'
        ? 'Панель пуста — перетащите сюда инструменты'
        : 'Перетащите сюда то, что не нужно на панели. Скрытые инструменты включаются горячей клавишей'));
    }
    col.append(head, box);
    if (list === 'items') {
      const add = el('button', 'tbe-add-group', '+ Новая группа');
      add.addEventListener('click', () => {
        const r = addGroup(toolbarConfig(), nextGroupName(toolbarConfig()));
        renameAfter = r.group;
        setStatus('Назовите группу и перетащите в неё инструменты');
        commit(r.cfg);
      });
      col.appendChild(add);
    }
    return col;
  }

  function toolRow(cfg: ToolbarConfig, id: ToolId, list: ToolbarList, topLevel: boolean): HTMLElement {
    const def = toolDef(id);
    const row = el('div', topLevel ? 'tbe-row tbe-entry' : 'tbe-row');
    row.dataset.tool = id;
    const grip = el('span', 'tbe-grip');
    grip.innerHTML = ICONS.grip;
    const icon = el('span', 'tbe-icon');
    icon.innerHTML = def.icon;
    const name = el('span', 'tbe-name', def.title);
    const code = cfg.keys[id];
    const key = el('button', 'tbe-key' + (code ? '' : ' empty'), code ? keyLabel(code) : '—');
    key.title = code ? `Горячая клавиша ${keyLabel(code)} — нажмите, чтобы сменить` : 'Назначить горячую клавишу';
    key.setAttribute('aria-label', `Горячая клавиша: ${def.title}`);
    key.addEventListener('click', () => {
      if (capture === id) stopCapture();
      else startCapture(id, key);
    });
    key.addEventListener('blur', () => { if (capture === id) stopCapture(); });
    const hide = list === 'hidden'
      ? iconButton('tbe-show', ICONS.eye, 'Показать на панели', () => commit(setEntryHidden(toolbarConfig(), { tool: id }, false)))
      : iconButton('tbe-hide', ICONS.eyeOff, 'Скрыть с панели', () => commit(setEntryHidden(toolbarConfig(), { tool: id }, true)));
    row.append(grip, icon, name, key, hide);
    row.addEventListener('pointerdown', e => beginDrag(e, { tool: id }, row));
    return row;
  }

  function groupCard(cfg: ToolbarConfig, g: ToolbarGroup, list: ToolbarList): HTMLElement {
    const card = el('div', 'tbe-group tbe-entry');
    card.dataset.group = g.id;
    const head = el('div', 'tbe-group-head');
    const grip = el('span', 'tbe-grip');
    grip.innerHTML = ICONS.grip;
    const icon = el('span', 'tbe-icon');
    icon.innerHTML = ICONS.folder;
    // название — текст, а не поле: за заголовок группу и перетаскивают; клик — переименовать
    const name = el('span', 'tbe-group-name', g.name);
    name.title = 'Нажмите, чтобы переименовать';
    name.addEventListener('click', () => startRename(g.id));
    const count = el('span', 'tbe-group-count', String(g.tools.length));
    const split = iconButton('tbe-ungroup', ICONS.ungroup, g.tools.length ? 'Разгруппировать' : 'Удалить группу',
      () => commit(ungroup(toolbarConfig(), g.id)));
    const hide = list === 'hidden'
      ? iconButton('tbe-show', ICONS.eye, 'Показать группу на панели', () => commit(setEntryHidden(toolbarConfig(), { group: g.id }, false)))
      : iconButton('tbe-hide', ICONS.eyeOff, 'Скрыть группу с панели', () => commit(setEntryHidden(toolbarConfig(), { group: g.id }, true)));
    head.append(grip, icon, name, count, split, hide);
    head.addEventListener('pointerdown', e => beginDrag(e, { group: g.id }, card));
    const body = el('div', 'tbe-group-body');
    for (const t of g.tools) body.appendChild(toolRow(cfg, t, list, false));
    if (g.tools.length === 0) body.appendChild(el('div', 'tbe-group-empty', 'Перетащите сюда инструменты'));
    card.append(head, body);
    return card;
  }

  // ----- Название группы -----

  function startRename(groupId: string): void {
    finishRename(true);
    const span = root.querySelector<HTMLElement>(`[data-group="${groupId}"] .tbe-group-name`);
    const group = [...toolbarConfig().items, ...toolbarConfig().hidden]
      .find((it): it is ToolbarGroup => it.type === 'group' && it.id === groupId);
    if (!span || !group) return;
    const input = el('input', 'tbe-group-name editing');
    input.value = group.name;
    input.maxLength = GROUP_NAME_MAX;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Название группы');
    span.replaceWith(input);
    renaming = { groupId, input, span };
    input.addEventListener('blur', () => finishRename(true));
    input.focus();
    input.select();
  }

  /**
   * Без перерисовки раздела: переименование заканчивается и нажатием на строку,
   * которую в этот момент начинают перетаскивать.
   */
  function finishRename(save: boolean): void {
    const r = renaming;
    if (!r) return;
    renaming = null;
    if (save) setToolbarConfig(renameGroup(toolbarConfig(), r.groupId, r.input.value));
    const group = [...toolbarConfig().items, ...toolbarConfig().hidden]
      .find((it): it is ToolbarGroup => it.type === 'group' && it.id === r.groupId);
    r.span.textContent = group?.name ?? r.span.textContent;
    if (r.input.isConnected) r.input.replaceWith(r.span);
    root.querySelector('.tbe-preview')?.replaceWith(preview(toolbarConfig()));
    if (save) setStatus(HINT);
  }

  // ----- Горячие клавиши -----

  function startCapture(id: ToolId, key: HTMLButtonElement): void {
    stopCapture();
    capture = id;
    key.classList.add('capturing');
    key.textContent = 'Нажмите…';
    setStatus(`«${toolDef(id).title}»: нажмите букву или цифру. Backspace — убрать клавишу, Esc — отмена`);
  }

  function stopCapture(): void {
    if (!capture) return;
    const id = capture;
    capture = null;
    const key = root.querySelector<HTMLElement>(`[data-tool="${id}"] .tbe-key`);
    const code = toolbarConfig().keys[id];
    if (key) {
      key.classList.remove('capturing');
      key.textContent = code ? keyLabel(code) : '—';
    }
    setStatus(HINT);
  }

  function assignKey(id: ToolId, code: string | null): void {
    capture = null;
    const title = toolDef(id).title;
    const r = setToolKey(toolbarConfig(), id, code);
    if (!code) setStatus(`У «${title}» больше нет горячей клавиши`);
    else if (r.displaced) setStatus(`Клавиша ${keyLabel(code)} теперь у «${title}», у «${toolDef(r.displaced).title}» она снята`);
    else setStatus(`«${title}» — клавиша ${keyLabel(code)}`);
    focusAfter = `[data-tool="${id}"] .tbe-key`;
    commit(r.cfg);
  }

  function captureKey(e: KeyboardEvent): boolean {
    const id = capture!;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key) || e.repeat) return true;
    if (e.key === 'Tab') { stopCapture(); return false; }
    if (e.key === 'Escape') { stopCapture(); return true; }
    if (e.code === 'Backspace' || e.code === 'Delete') { assignKey(id, null); return true; }
    if (e.ctrlKey || e.altKey || e.metaKey) { setStatus('Нужна одна клавиша, без Ctrl и Alt', true); return true; }
    const problem = keyProblem(e.code);
    if (problem) { setStatus(problem, true); return true; }
    assignKey(id, e.code);
    return true;
  }

  // ----- Перетаскивание -----

  function beginDrag(e: PointerEvent, ref: EntryRef, source: HTMLElement): void {
    if (e.button !== 0 || drag) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, button')) return;
    // пальцем список прокручивается, а тянут за ручку
    if (e.pointerType === 'touch' && !t.closest('.tbe-grip')) return;
    drag = {
      ref, source, pointerId: e.pointerId,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      started: false, ghost: null, hit: null, raf: 0,
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', cancelDrag);
  }

  function ghostFor(ref: EntryRef): HTMLElement {
    const g = el('div', 'tbe-ghost');
    const icon = el('span', 'tbe-icon');
    if ('tool' in ref) {
      icon.innerHTML = toolDef(ref.tool).icon;
      g.append(icon, el('span', 'tbe-name', toolDef(ref.tool).title));
    } else {
      const group = [...toolbarConfig().items, ...toolbarConfig().hidden]
        .find((it): it is ToolbarGroup => it.type === 'group' && it.id === ref.group);
      icon.innerHTML = ICONS.folder;
      g.append(icon, el('span', 'tbe-name', group?.name ?? ''), el('span', 'tbe-group-count', String(group?.tools.length ?? 0)));
    }
    return g;
  }

  function onDragMove(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.started) {
      if (Math.hypot(d.x - d.x0, d.y - d.y0) < DRAG_THRESHOLD) return;
      d.started = true;
      try { d.source.setPointerCapture(d.pointerId); } catch { /* синтетический pointer */ }
      d.ghost = ghostFor(d.ref);
      document.body.appendChild(d.ghost);
      d.source.classList.add('tbe-dragging');
      document.body.classList.add('tbe-grabbing');
      d.raf = requestAnimationFrame(autoScroll);
    }
    e.preventDefault();
    // ярлык — сбоку от курсора, чтобы не закрывать строку, на которую бросают
    d.ghost!.style.left = `${d.x + GHOST_OFFSET}px`;
    d.ghost!.style.top = `${d.y + GHOST_OFFSET}px`;
    updateHit();
  }

  function onDragEnd(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    const hit = d.started ? hitAt(d.x, d.y) : null;
    endDrag();
    if (!hit) return;
    if ('combine' in hit.drop) {
      if (!('tool' in d.ref)) return;
      const r = combineTools(toolbarConfig(), hit.drop.combine, d.ref.tool, nextGroupName(toolbarConfig()));
      if (!r.group) return;
      renameAfter = r.group;
      setStatus('Получилась группа — введите её название');
      commit(r.cfg);
      return;
    }
    const next = moveEntry(toolbarConfig(), d.ref, hit.drop);
    if (next !== toolbarConfig()) commit(next);
  }

  function cancelDrag(): void {
    endDrag();
  }

  function endDrag(): void {
    const d = drag;
    if (!d) return;
    drag = null;
    cancelAnimationFrame(d.raf);
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', cancelDrag);
    d.ghost?.remove();
    d.source.classList.remove('tbe-dragging');
    document.body.classList.remove('tbe-grabbing');
    showMark(null);
    if (d.started) setStatus(HINT);
  }

  /** Куда упадёт перетаскиваемое, если отпустить в точке экрана. */
  function hitAt(x: number, y: number): Hit | null {
    const d = drag;
    if (!d) return null;
    const under = document.elementFromPoint(x, y);
    const listEl = under?.closest<HTMLElement>('.tbe-list');
    if (!under || !listEl || !root.contains(listEl)) return null;
    const list = listEl.dataset.list as ToolbarList;
    const entry = under.closest<HTMLElement>('.tbe-entry');
    if (!entry) {
      // пустое место списка — в конец
      const entries = listEl.querySelectorAll<HTMLElement>(':scope > .tbe-entry');
      const last = entries[entries.length - 1];
      return { drop: { list, before: null }, el: last ?? listEl, mode: last ? 'after' : 'into' };
    }
    const r = entry.getBoundingClientRect();
    const before = (): Hit => ({ drop: { list, before: refOfEl(entry) }, el: entry, mode: 'before' });
    const after = (): Hit => ({ drop: { list, before: refOfEl(entry.nextElementSibling) }, el: entry, mode: 'after' });
    // группу ставят только между элементами верхнего уровня
    if ('group' in d.ref) return y < r.top + r.height / 2 ? before() : after();
    if (entry.dataset.group) {
      const group = entry.dataset.group;
      const row = under.closest<HTMLElement>('.tbe-group-body .tbe-row');
      if (row) {
        const rr = row.getBoundingClientRect();
        return y < rr.top + rr.height / 2
          ? { drop: { list, group, before: refOfEl(row) }, el: row, mode: 'before' }
          : { drop: { list, group, before: refOfEl(row.nextElementSibling) }, el: row, mode: 'after' };
      }
      // верхний край заголовка — перед группой, остальное — в группу
      const hr = entry.querySelector('.tbe-group-head')!.getBoundingClientRect();
      if (y < hr.top + hr.height * EDGE) return before();
      return { drop: { list, group, before: null }, el: entry, mode: 'into' };
    }
    const rel = (y - r.top) / r.height;
    if (rel < EDGE) return before();
    if (rel > 1 - EDGE) return after();
    if (entry.dataset.tool === d.ref.tool) return null;
    return { drop: { combine: entry.dataset.tool as ToolId }, el: entry, mode: 'combine' };
  }

  function updateHit(): void {
    const d = drag;
    if (!d) return;
    d.hit = hitAt(d.x, d.y);
    showMark(d.hit);
    const h = d.hit;
    if (h && 'combine' in h.drop && 'tool' in d.ref) {
      setStatus(`Отпустите — «${toolDef(d.ref.tool).title}» и «${toolDef(h.drop.combine).title}» станут группой`);
    } else if (status !== HINT) {
      setStatus(HINT);
    }
  }

  /** Линия вставки между строками или подсветка группы/строки, куда упадёт. */
  function showMark(hit: Hit | null): void {
    for (const m of root.querySelectorAll('.tbe-drop-into, .tbe-drop-combine')) m.classList.remove('tbe-drop-into', 'tbe-drop-combine');
    if (!hit || hit.mode === 'into' || hit.mode === 'combine') {
      indicator?.remove();
      indicator = null;
      if (hit) hit.el.classList.add(hit.mode === 'into' ? 'tbe-drop-into' : 'tbe-drop-combine');
      return;
    }
    if (!indicator) {
      indicator = el('div', 'tbe-indicator');
      document.body.appendChild(indicator);
    }
    const r = hit.el.getBoundingClientRect();
    const lr = hit.el.closest('.tbe-list')!.getBoundingClientRect();
    // линия — посередине зазора между строками и не выходит за видимую часть списка
    const y = hit.mode === 'before' ? r.top - 2 : r.bottom + 2;
    indicator.hidden = y < lr.top || y > lr.bottom;
    indicator.style.left = `${r.left}px`;
    indicator.style.width = `${r.width}px`;
    indicator.style.top = `${y - 1}px`;
  }

  /** У края списка он сам прокручивается, пока держат перетаскиваемое. */
  function autoScroll(): void {
    const d = drag;
    if (!d) return;
    for (const l of root.querySelectorAll<HTMLElement>('.tbe-list')) {
      const r = l.getBoundingClientRect();
      if (d.x < r.left || d.x > r.right || d.y < r.top - SCROLL_ZONE || d.y > r.bottom + SCROLL_ZONE) continue;
      let v = 0;
      if (d.y < r.top + SCROLL_ZONE) v = -Math.min(1, (r.top + SCROLL_ZONE - d.y) / SCROLL_ZONE) * 12;
      else if (d.y > r.bottom - SCROLL_ZONE) v = Math.min(1, (d.y - r.bottom + SCROLL_ZONE) / SCROLL_ZONE) * 12;
      if (v !== 0) {
        const before = l.scrollTop;
        l.scrollTop += v;
        if (l.scrollTop !== before) updateHit();
      }
    }
    d.raf = requestAnimationFrame(autoScroll);
  }

  draw();

  return {
    onKey(e) {
      if (capture) return captureKey(e);
      if (renaming && (e.key === 'Enter' || e.key === 'Escape')) {
        finishRename(e.key === 'Enter');
        return true;
      }
      if (drag && e.key === 'Escape') { cancelDrag(); return true; }
      return false;
    },
    dispose() {
      finishRename(true);
      endDrag();
      capture = null;
    },
  };
}
