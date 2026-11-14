import type { CommentThread, Element } from './types';
import { onChange, onDraft, replaceElements, state, touchProject, update } from './state';
import { addCommentReply, createCommentThread, resolveCommentThread, toggleElementReaction } from './comments';
import { elementAABB } from './geom';
import { canEditPagesNote, noteName, sendComment, sendReaction, type CommentRequest } from './collab-notes';
import { clientId } from './identity';
import { PIN_R, hitAnnotation, layoutPills, layoutPins } from './annotations';

// Интерфейс реакций и комментариев: быстрые реакции для выделенного, нажатия на пилюли и пины, поповер ветки.
// Работает у автора, у участников комнаты (читатель тоже) и скрыт при просмотре по ссылке.

/** Быстрые реакции. */
export const QUICK_REACTIONS = ['👍', '❤️', '🔥', '❓', '✅'];

/** Реакции и комментарии доступны: не просмотр по ссылке и не черновик (его не видит никто, кроме автора). */
export function annotationsAvailable(): boolean {
  return state.linkMode === null && state.view === 'board' && !onDraft();
}

function selected(): Element[] {
  return state.board.elements.filter(e => state.selection.has(e.id));
}

/** Реакция на элемент: через хаб в комнате, у себя — вне её (мимо истории отмены). */
export function toggleReactionOn(elId: string, emoji: string): void {
  if (!annotationsAvailable()) return;
  if (sendReaction(state.pageId, elId, emoji)) return;
  // читатель без хаба с поддержкой реакций поставить их не может: правка доски ему не положена
  if (!canEditPagesNote()) return;
  replaceElements(state.board.elements.map(e => (e.id === elId ? toggleElementReaction(e, emoji, clientId()) : e)));
}

/** Реакция на всё выделенное. */
export function reactToSelection(emoji: string): void {
  for (const el of selected()) toggleReactionOn(el.id, emoji);
}

/** Кнопки для меню выделения: реакции и «Комментировать». */
export function annotationButtons(): HTMLElement[] {
  if (!annotationsAvailable() || selected().length === 0) return [];
  const out: HTMLElement[] = [];
  const box = document.createElement('div');
  box.className = 'qm-reactions';
  const mine = clientId();
  const els = selected();
  for (const emoji of QUICK_REACTIONS) {
    const b = document.createElement('button');
    b.className = 'qm-btn qm-react';
    b.type = 'button';
    b.title = `Реакция ${emoji}`;
    b.setAttribute('aria-label', b.title);
    b.textContent = emoji;
    b.classList.toggle('active', els.every(e => e.reactions?.[emoji]?.includes(mine)));
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => reactToSelection(emoji));
    box.appendChild(b);
  }
  out.push(box);
  if (els.length === 1) {
    const c = document.createElement('button');
    c.className = 'qm-btn qm-comment';
    c.type = 'button';
    c.title = 'Комментировать';
    c.setAttribute('aria-label', c.title);
    c.textContent = '💬';
    c.addEventListener('mousedown', e => e.preventDefault());
    c.addEventListener('click', () => startComment(els[0]));
    out.push(c);
  }
  return out;
}

// ----- Нажатия на холсте -----

/**
 * Нажатие по пилюле реакции или пину комментария (x, y — экранные координаты холста).
 * true — нажатие обработано, холст его дальше не разбирает.
 */
export function annotationClick(x: number, y: number): boolean {
  if (!annotationsAvailable()) return false;
  const r = host()?.getBoundingClientRect();
  const w = r && r.width > 0 ? r.width : window.innerWidth;
  const h = r && r.height > 0 ? r.height : window.innerHeight;
  const hit = hitAnnotation(layoutPills(state.board.elements, state.camera, clientId(), w, h), layoutPins(state.board.comments, state.camera, w, h), x, y);
  if (!hit) return false;
  if (hit.kind === 'pill') toggleReactionOn(hit.pill.elId, hit.pill.emoji);
  else openThread(hit.pin.threadId);
  return true;
}

// ----- Поповер ветки -----

type PopState = { kind: 'thread'; id: string } | { kind: 'new'; targetId: string; x: number; y: number };
interface Pop { el: HTMLElement; state: PopState; list: HTMLElement; sig: string; input: HTMLTextAreaElement }
let pop: Pop | null = null;

function host(): HTMLElement | null {
  return document.getElementById('ctx-layer');
}

function threadOf(id: string): CommentThread | undefined {
  return state.board.comments?.find(t => t.id === id);
}

function time(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function make<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement | null, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export function closeThread(): void {
  pop?.el.remove();
  pop = null;
}

export function threadOpen(): boolean {
  return pop !== null;
}

/** Новая ветка к элементу: поповер с полем ввода у правого верхнего угла элемента. */
export function startComment(el: Element): void {
  if (!annotationsAvailable()) return;
  const a = elementAABB(el);
  openPop({ kind: 'new', targetId: el.id, x: a.x1, y: a.y0 });
}

export function openThread(id: string): void {
  if (!annotationsAvailable() || !threadOf(id)) return;
  openPop({ kind: 'thread', id });
}

function openPop(st: PopState): void {
  closeThread();
  const layer = host();
  if (!layer) return;
  const el = make(layer, 'div', 'comment-pop');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Комментарий');
  const head = make(el, 'div', 'cp-head');
  make(head, 'span', 'cp-title', st.kind === 'new' ? 'Новый комментарий' : 'Комментарий');
  const close = make(head, 'button', 'cp-close', '×');
  close.type = 'button';
  close.title = 'Закрыть (Esc)';
  close.addEventListener('click', closeThread);
  const list = make(el, 'div', 'cp-list');
  const input = make(el, 'textarea', 'cp-input');
  input.rows = 2;
  input.maxLength = 2000;
  input.placeholder = st.kind === 'new' ? 'Напишите комментарий…' : 'Ответить…';
  input.spellcheck = false;
  const row = make(el, 'div', 'cp-actions');
  const send = make(row, 'button', 'cp-send', st.kind === 'new' ? 'Отправить' : 'Ответить');
  send.type = 'button';
  send.addEventListener('click', () => submit());
  if (st.kind === 'thread') {
    const resolve = make(row, 'button', 'cp-resolve');
    resolve.type = 'button';
    resolve.addEventListener('click', () => {
      const t = threadOf(st.id);
      if (t) change({ op: 'resolve', threadId: t.id, resolved: !t.resolved }, p => resolveCommentThread(p, t.id, !t.resolved));
    });
  }
  input.addEventListener('keydown', e => {
    e.stopPropagation(); // буквы и Delete в поле — не горячие клавиши доски
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') closeThread();
  });
  for (const type of ['pointerdown', 'dblclick', 'contextmenu', 'wheel'] as const) el.addEventListener(type, e => e.stopPropagation());
  pop = { el, state: st, list, sig: '', input };
  refresh();
  input.focus();
}

/** Правка комментариев: через хаб в комнате, иначе — у себя (мимо истории отмены). */
function change(req: CommentRequest, local: (page: typeof state.board) => typeof state.board): void {
  if (sendComment(state.pageId, req)) return;
  if (!canEditPagesNote()) return;
  const next = local(state.board);
  if (next === state.board) return;
  if (next.comments) state.board.comments = next.comments;
  else delete state.board.comments;
  touchProject();
  update();
}

function submit(): void {
  const p = pop;
  if (!p) return;
  const text = p.input.value.trim();
  if (text === '') return;
  const author = { authorId: clientId(), authorName: noteName() };
  if (p.state.kind === 'new') {
    const st = p.state;
    change({ op: 'create', x: st.x, y: st.y, targetElementId: st.targetId, text },
      page => createCommentThread(page, { x: st.x, y: st.y, targetElementId: st.targetId, ...author, text }));
    // ветка получила id уже у хаба; в поповер её не переносим — пользователь увидит пин и откроет его
    closeThread();
    return;
  }
  const id = p.state.id;
  p.input.value = '';
  change({ op: 'reply', threadId: id, text }, page => addCommentReply(page, id, { ...author, text }));
}

/** Перерисовка поповера: пропала ветка — закрыть; изменился состав — пересобрать сообщения; всегда — положение. */
function refresh(): void {
  const p = pop;
  if (!p) return;
  if (!annotationsAvailable()) { closeThread(); return; }
  let anchor: { x: number; y: number };
  if (p.state.kind === 'thread') {
    const t = threadOf(p.state.id);
    if (!t) { closeThread(); return; }
    anchor = { x: t.x, y: t.y };
    const sig = JSON.stringify([t.resolved ?? false, t.messages.map(m => m.id)]);
    if (sig !== p.sig) {
      p.sig = sig;
      p.list.textContent = '';
      for (const m of t.messages) {
        const item = make(p.list, 'div', 'cp-msg');
        const meta = make(item, 'div', 'cp-meta');
        make(meta, 'span', 'cp-author', m.authorName || 'Участник');
        make(meta, 'span', 'cp-time', time(m.createdAt));
        make(item, 'div', 'cp-text', m.text);
      }
      const resolve = p.el.querySelector<HTMLButtonElement>('.cp-resolve');
      if (resolve) resolve.textContent = t.resolved ? 'Вернуть в обсуждение' : 'Решено';
      p.el.classList.toggle('resolved', !!t.resolved);
      p.list.scrollTop = p.list.scrollHeight;
    }
  } else {
    anchor = { x: p.state.x, y: p.state.y };
  }
  const cam = state.camera;
  const layer = host()!;
  const lw = layer.clientWidth || window.innerWidth;
  const lh = layer.clientHeight || window.innerHeight;
  const ew = p.el.offsetWidth || 280;
  const eh = p.el.offsetHeight || 200;
  const sx = (anchor.x - cam.x) * cam.zoom + PIN_R + 8;
  const sy = (anchor.y - cam.y) * cam.zoom - PIN_R;
  p.el.style.left = `${Math.max(8, Math.min(sx, lw - ew - 8))}px`;
  p.el.style.top = `${Math.max(8, Math.min(sy, lh - eh - 8))}px`;
}

/** Подключает слежение за состоянием и закрытие поповера по Esc и нажатию мимо. */
export function initCommentsUi(): void {
  onChange(refresh);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pop) { e.stopPropagation(); closeThread(); }
  }, true);
  document.addEventListener('pointerdown', e => {
    if (pop && !pop.el.contains(e.target as Node) && !(e.target as HTMLElement | null)?.closest?.('.qm-comment')) {
      // нажатие по пину откроет ветку само (annotationClick), остальное закрывает
      closeThread();
    }
  }, true);
}

