// Слой плашек объектов над холстом (SPEC_COMMENTS §1–4): #annot-layer, строка под правым нижним углом рамки
// каждого объекта с реакциями или комментариями — [реакции…][+n][😊+][💬 n]. Раскладка — src/annotations.ts,
// положение — каждый кадр холста (onBoardFrame), содержимое строки пересобирается только при изменении.
//  • Пилюля реакции: яркий фон — цвет плашки первого, кто её поставил (src/note-people.ts), эмодзи и счётчик.
//    Своя: при наведении вместо счётчика ×, щелчок по × или удержание 500 мс (планшет) — снять. Щелчок по пилюле —
//    «Привлечь внимание» (src/attention.ts). Подсказка — кто поставил.
//  • «+n» — меню со всеми реакциями объекта и тем, кто их поставил; у своих — ×.
//  • Выделен один объект и можно реагировать — кнопки «Поставить реакцию» (окно смайлов, как у иконки проекта;
//    при наведении влево выезжают недавние реакции) и «Комментировать» со счётчиком. У невыделенного объекта
//    на месте второй — только счётчик комментариев (щелчок открывает обсуждение).
// Эмодзи, имена и числа — только textContent; SVG — константы каталога иконок.

import { onChange, state } from './state';
import { onBoardFrame, requestRender } from './renderer';
import { layoutAnnotRows, type AnnotRow } from './annotations';
import { onAnnotView, recentReactions, showComments, showReactions } from './annot-prefs';
import { notePerson, peopleLabel } from './note-people';
import { addReaction, annotationsAvailable, canAnnotate, openDiscussion, removeReaction } from './comments-ui';
import { attractAttention } from './attention';
import { createIconButton, type IconButton } from './icon-button';
import { closeIconPicker, iconPickerOpen } from './icon-picker';
import { claimMenu, closeMenu, openMenu, releaseMenu } from './menu-motion';
import { clientId } from './identity';
import { COMMENT_ICON } from './icons';

/** Удержание своей реакции столько — снять её (планшеты). */
export const HOLD_MS = 500;

interface RowNode {
  root: HTMLElement;
  pills: HTMLElement;
  pillsSig: string;
  tools: HTMLElement | null;
  react: IconButton | null;
  recent: HTMLElement | null;
  recentSig: string;
  comment: HTMLButtonElement;
  commentSig: string;
}

let layer: HTMLElement | null = null;
const rows = new Map<string, RowNode>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function host(): HTMLElement | null {
  if (layer?.isConnected) return layer;
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return null;
  layer = document.getElementById('annot-layer') ?? el('div', '');
  layer.id = 'annot-layer';
  if (!layer.isConnected) {
    // над холстом и оверлеем заданий, под меню и курсорами
    const anchor = document.getElementById('task-overlay');
    if (anchor?.parentElement === wrap) anchor.after(layer);
    else wrap.appendChild(layer);
  }
  // слой никогда не прокручивается: фокус с клавиатуры на кнопке у края (или автопрокрутка к элементу) сдвинул бы
  // его содержимое, и плашки разошлись бы с объектами (холст при этом сдвигается вместе со слоем — он его родитель)
  const pin = (n: HTMLElement) => n.addEventListener('scroll', () => {
    if (!n.scrollTop && !n.scrollLeft) return;
    n.scrollTop = 0;
    n.scrollLeft = 0;
    requestRender(); // панели у плашек встают на место по кадру
  });
  pin(layer);
  // колесо над плашкой — холсту: масштаб и прокрутка не «застревают» на пилюле
  layer.addEventListener('wheel', e => {
    const canvas = document.getElementById('board');
    if (!canvas) return;
    e.preventDefault();
    canvas.dispatchEvent(new WheelEvent('wheel', {
      deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY,
      ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, bubbles: true, cancelable: true,
    }));
  }, { passive: false });
  // нажатия по плашкам — не холсту (не снимают выделение) и не горячим клавишам доски
  for (const type of ['pointerdown', 'dblclick', 'contextmenu'] as const) {
    layer.addEventListener(type, e => { if ((e.target as Element).closest('.an-row button, .an-row .an-recent')) e.stopPropagation(); });
  }
  return layer;
}

/** Объект, у которого кнопки: выделен ровно один, его не редактируют, и можно реагировать. */
function toolsTarget(): string | null {
  if (state.selection.size !== 1 || !canAnnotate()) return null;
  const id = [...state.selection][0];
  if (state.hideElId === id || state.liveText) return null;
  return state.board.elements.some(e => e.id === id) ? id : null;
}

// ----- Пилюли -----

function pillTitle(users: readonly string[], mine: boolean): string {
  const who = peopleLabel(users);
  return mine ? `${who}. Нажмите - привлечь внимание, × или удержание - убрать` : `${who}. Нажмите - привлечь внимание`;
}

function pill(elId: string, emoji: string, users: readonly string[]): HTMLButtonElement {
  const me = clientId();
  const mine = users.includes(me);
  const who = notePerson(users[0]);
  const b = el('button', `an-pill${mine ? ' mine' : ''}`);
  b.type = 'button';
  b.dataset.emoji = emoji;
  b.style.setProperty('--an-bg', who.bg);
  b.style.setProperty('--an-fg', who.fg);
  b.title = pillTitle(users, mine);
  b.dataset.tipSide = 'top';
  b.setAttribute('aria-label', `${emoji} ${users.length}: ${peopleLabel(users, 8)}`);
  const face = el('span', 'an-emoji', emoji);
  const num = el('span', 'an-num', String(users.length));
  b.append(face, num);
  if (mine) {
    const x = el('span', 'an-x', '×');
    x.setAttribute('aria-hidden', 'true');
    x.title = 'Убрать реакцию';
    b.append(x);
    holdToRemove(b, () => removeReaction(elId, emoji));
    b.addEventListener('keydown', e => {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); removeReaction(elId, emoji); }
    });
  }
  b.addEventListener('click', e => {
    if (b.dataset.held === '1') { delete b.dataset.held; return; }
    if (mine && (e.target as Element).closest('.an-x')) { removeReaction(elId, emoji); return; }
    attractAttention(elId, emoji);
  });
  return b;
}

/** Удержание кнопки HOLD_MS — действие (кнопка заливается, пока держат); щелчок после него не срабатывает. */
function holdToRemove(b: HTMLElement, run: () => void): void {
  let timer = 0;
  const stop = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    b.classList.remove('holding');
  };
  b.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    stop();
    b.classList.add('holding');
    timer = window.setTimeout(() => {
      timer = 0;
      b.classList.remove('holding');
      b.dataset.held = '1';
      try { navigator.vibrate?.(12); } catch { /* нет вибрации */ }
      run();
    }, HOLD_MS);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) b.addEventListener(type, stop);
  // долгое касание на планшете не открывает системное меню
  b.addEventListener('contextmenu', e => e.preventDefault());
}

function moreButton(elId: string, hidden: number): HTMLButtonElement {
  const b = el('button', 'an-more', `+${hidden}`);
  b.type = 'button';
  b.title = 'Все реакции';
  b.dataset.tipSide = 'top';
  b.setAttribute('aria-haspopup', 'dialog');
  b.addEventListener('click', () => toggleReactionsMenu(b, elId));
  return b;
}

function pillsSig(r: AnnotRow): string {
  const me = clientId();
  const parts = r.reactions.slice(0, r.shown).map(([e, u]) => {
    const who = notePerson(u[0]);
    return `${e}:${u.length}:${u.includes(me) ? 1 : 0}:${who.bg}:${who.fg}:${u.map(id => notePerson(id).name).join('|')}`;
  });
  return `${parts.join(',')}+${r.reactions.length - r.shown}`;
}

function renderPills(n: RowNode, r: AnnotRow): void {
  const sig = pillsSig(r);
  if (sig === n.pillsSig) return;
  n.pillsSig = sig;
  n.pills.textContent = '';
  for (let i = 0; i < r.shown; i++) n.pills.append(pill(r.elId, r.reactions[i][0], r.reactions[i][1]));
  if (r.shown < r.reactions.length) n.pills.append(moreButton(r.elId, r.reactions.length - r.shown));
}

// ----- Кнопки выделенного -----

function buildTools(n: RowNode, elId: string): void {
  const wrap = el('div', 'an-react-wrap');
  const recent = el('div', 'an-recent');
  recent.setAttribute('role', 'group');
  recent.setAttribute('aria-label', 'Недавние реакции');
  const react = createIconButton({
    className: 'an-btn an-react',
    value: null,
    showValue: false,
    title: () => 'Поставить реакцию',
    picker: { label: 'Реакция', upload: false },
    onPick: v => { if (v) addReaction(elId, v); },
  });
  react.el.dataset.tipSide = 'top';
  react.el.setAttribute('aria-label', 'Поставить реакцию');
  // После выбора снова раскрываем ленту только при явном возвращении к кнопке.
  for (const type of ['pointerenter', 'focus'] as const) {
    react.el.addEventListener(type, () => wrap.classList.remove('an-picked'));
  }
  wrap.append(recent, react.el);
  n.root.insertBefore(wrap, n.comment);
  n.tools = wrap;
  n.react = react;
  n.recent = recent;
  n.recentSig = '';
  // анимация появления кнопок — один раз, при выделении
  n.root.classList.add('an-enter');
  window.setTimeout(() => n.root.classList.remove('an-enter'), 400);
}

function renderRecent(n: RowNode, elId: string): void {
  if (!n.recent) return;
  const list = recentReactions();
  const sig = list.join(',');
  if (sig === n.recentSig) return;
  n.recentSig = sig;
  n.recent.textContent = '';
  list.forEach((emoji, i) => {
    const b = el('button', 'an-recent-btn', emoji);
    b.type = 'button';
    b.title = `Реакция ${emoji}`;
    b.setAttribute('aria-label', b.title);
    // выезжают по очереди от кнопки: ближняя — первой
    b.style.setProperty('--i', String(list.length - 1 - i));
    b.addEventListener('click', () => {
      addReaction(elId, emoji);
      // реакция поставлена — лента уезжает обратно (иначе закрывала бы пилюли слева, пока мышь над ней)
      const wrap = n.tools;
      if (!wrap) return;
      wrap.classList.add('an-picked');
      b.blur();
    });
    n.recent!.append(b);
  });
}

function dropTools(n: RowNode): void {
  if (!n.tools) return;
  if (iconPickerOpen() && n.react && document.querySelector('#icon-picker')) closeIconPicker();
  n.tools.remove();
  n.tools = null;
  n.react = null;
  n.recent = null;
}

function renderComment(n: RowNode, r: AnnotRow): void {
  const sig = `${r.comments}:${r.resolved ? 1 : 0}:${r.tools ? 1 : 0}`;
  if (sig === n.commentSig) return;
  n.commentSig = sig;
  const b = n.comment;
  b.hidden = !r.tools && r.comments === 0;
  b.classList.toggle('an-counter', !r.tools);
  b.classList.toggle('resolved', r.resolved);
  b.classList.toggle('empty', r.comments === 0);
  const num = b.querySelector<HTMLElement>('.an-cnum')!;
  num.textContent = r.comments > 0 ? String(r.comments) : '';
  const label = r.comments > 0
    ? `Комментарии: ${r.comments}${r.resolved ? ' (решено)' : ''}`
    : 'Комментировать';
  b.title = r.tools ? (r.comments > 0 ? `Комментировать · ${r.comments}` : 'Комментировать') : label;
  b.setAttribute('aria-label', b.title);
}

function buildRow(elId: string): RowNode {
  const root = el('div', 'an-row');
  root.dataset.el = elId;
  const pills = el('div', 'an-pills');
  const comment = el('button', 'an-comment');
  comment.type = 'button';
  comment.dataset.tipSide = 'top';
  const icon = el('span', 'an-cicon');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = COMMENT_ICON; // константа каталога иконок
  comment.append(icon, el('span', 'an-cnum'));
  comment.addEventListener('click', () => openDiscussion(elId, comment));
  root.append(pills, comment);
  return { root, pills, pillsSig: '', tools: null, react: null, recent: null, recentSig: '', comment, commentSig: '' };
}

// ----- Синхронизация -----

/** Строки по состоянию доски и камере: новые создаются, ушедшие удаляются, остальные двигаются. */
export function syncAnnotLayer(): void {
  const root = host();
  if (!root) return;
  const seen = new Set<string>();
  if (annotationsAvailable() && !state.layerPreview) {
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;
    const list = layoutAnnotRows(state.board.elements, state.board.comments, state.camera, w, h, {
      toolsFor: toolsTarget(), showReactions: showReactions(), showComments: showComments(),
    });
    for (const r of list) {
      seen.add(r.elId);
      let n = rows.get(r.elId);
      if (!n) {
        n = buildRow(r.elId);
        rows.set(r.elId, n);
        root.append(n.root);
      }
      renderPills(n, r);
      if (r.tools && !n.tools) buildTools(n, r.elId);
      else if (!r.tools && n.tools) dropTools(n);
      if (n.tools) renderRecent(n, r.elId);
      renderComment(n, r);
      n.root.classList.toggle('selected', r.tools);
      n.root.style.transform = `translate(${r.right.toFixed(1)}px, ${r.top.toFixed(1)}px) translateX(-100%)`;
    }
  }
  for (const [id, n] of rows) {
    if (seen.has(id)) continue;
    dropTools(n);
    n.root.remove();
    rows.delete(id);
    if (menuFor === id) closeReactionsMenu(true);
  }
  if (menuFor && seen.has(menuFor)) refreshReactionsMenu();
}

/** Узел строки объекта (для тестов и панели обсуждения: откуда она «выходит»). */
export function annotRowOf(elId: string): HTMLElement | null {
  return rows.get(elId)?.root ?? null;
}

/** Кнопка «Комментировать» / счётчик объекта, если строка сейчас на экране. */
export function commentButtonOf(elId: string): HTMLButtonElement | null {
  return rows.get(elId)?.comment ?? null;
}

// ----- Меню «+n»: все реакции объекта -----

let menu: HTMLElement | null = null;
let menuFor: string | null = null;
let menuAnchor: HTMLElement | null = null;
let menuSig = '';
let menuOff: (() => void) | null = null;

export function reactionsMenuOpen(): boolean {
  return menu !== null;
}

function menuEntries(elId: string): [string, string[]][] {
  const e = state.board.elements.find(x => x.id === elId);
  return e?.reactions ? Object.entries(e.reactions).filter(([, u]) => u.length > 0) : [];
}

function fillMenu(): void {
  if (!menu || !menuFor) return;
  const elId = menuFor;
  const list = menuEntries(elId);
  const me = clientId();
  const sig = JSON.stringify(list.map(([e, u]) => [e, u.map(id => { const p = notePerson(id); return `${id}:${p.name}:${p.bg}`; })]));
  if (sig === menuSig) return;
  menuSig = sig;
  menu.textContent = '';
  const head = el('div', 'arm-head', `Реакции · ${list.reduce((s, [, u]) => s + u.length, 0)}`);
  menu.append(head);
  const body = el('div', 'arm-list');
  for (const [emoji, users] of list) {
    const row = el('div', 'arm-row');
    const face = el('button', 'arm-emoji', emoji);
    face.type = 'button';
    face.title = 'Привлечь внимание';
    face.addEventListener('click', () => attractAttention(elId, emoji));
    const count = el('span', 'arm-count', String(users.length));
    const who = el('div', 'arm-who');
    for (const id of users) {
      const p = notePerson(id);
      const chip = el('span', 'arm-chip', p.name);
      chip.style.setProperty('--an-bg', p.bg);
      chip.style.setProperty('--an-fg', p.fg);
      who.append(chip);
    }
    row.append(face, count, who);
    if (users.includes(me) && canAnnotate()) {
      const x = el('button', 'arm-remove', '×');
      x.type = 'button';
      x.title = 'Убрать мою реакцию';
      x.setAttribute('aria-label', `Убрать мою реакцию ${emoji}`);
      x.addEventListener('click', () => removeReaction(elId, emoji));
      row.append(x);
    }
    body.append(row);
  }
  menu.append(body);
}

function placeMenu(): void {
  if (!menu || !menuAnchor) return;
  const a = menuAnchor.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const m = 8;
  let left = a.left + a.width / 2 - w / 2;
  let top = a.bottom + 6;
  if (top + h > window.innerHeight - m && a.top - 6 - h >= m) top = a.top - 6 - h;
  left = Math.max(m, Math.min(left, window.innerWidth - w - m));
  top = Math.max(m, Math.min(top, window.innerHeight - h - m));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function refreshReactionsMenu(): void {
  if (!menu || !menuFor) return;
  if (menuEntries(menuFor).length === 0) { closeReactionsMenu(); return; }
  fillMenu();
}

export function closeReactionsMenu(instant = false): void {
  if (!menu) return;
  const m = menu;
  menu = null;
  menuFor = null;
  menuAnchor = null;
  menuSig = '';
  menuOff?.();
  menuOff = null;
  releaseMenu('reactions');
  closeMenu(m, instant);
}

function toggleReactionsMenu(anchor: HTMLElement, elId: string): void {
  if (menu && menuFor === elId) { closeReactionsMenu(); return; }
  closeReactionsMenu(true);
  claimMenu('reactions', () => closeReactionsMenu());
  const m = el('div', 'popup-menu reactions-menu');
  m.id = 'reactions-menu';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-label', 'Все реакции');
  document.body.append(m);
  menu = m;
  menuFor = elId;
  menuAnchor = anchor;
  fillMenu();
  openMenu(m, { from: anchor, place: placeMenu, remove: true, items: () => [...m.querySelectorAll<HTMLElement>('.arm-row')] });
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!m.contains(t) && !anchor.contains(t)) closeReactionsMenu();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeReactionsMenu(); } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  menuOff = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  };
}

let inited = false;

/** Подключает слой: кадры холста, изменения доски и настройки показа. */
export function initAnnotLayer(): void {
  if (inited) return;
  inited = true;
  onBoardFrame(() => syncAnnotLayer());
  onChange(syncAnnotLayer);
  onAnnotView(() => { syncAnnotLayer(); requestRender(); }); // счётчики в окне демонстрации рисует холст
  // недавние реакции и цвета участников могли смениться — пересобрать при следующем кадре
  syncAnnotLayer();
}

/** Для тестов: забыть строки и слой. */
export function resetAnnotLayer(): void {
  closeReactionsMenu(true);
  for (const n of rows.values()) n.root.remove();
  rows.clear();
  layer?.remove();
  layer = null;
}
