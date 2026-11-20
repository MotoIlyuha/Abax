import type { CommentThread, Element } from './types';
import { onChange, onDraft, replaceElements, state, touchProject, update } from './state';
import { addCommentReply, createCommentThread, resolveCommentThread, toggleElementReaction } from './comments';
import { elementAABB } from './geom';
import { canEditPagesNote, noteName, sendComment, sendReaction, type CommentRequest } from './collab-notes';
import { clientId } from './identity';
import { myCollabCaps } from './collab';
import { PIN_R, hitPin, layoutPins } from './annotations';
import { noteRecentReaction, showComments } from './annot-prefs';

// Интерфейс реакций и комментариев: быстрые реакции для выделенного, нажатия на пилюли и пины, поповер ветки.
// Работает у автора, у участников комнаты (читатель тоже) и скрыт при просмотре по ссылке.

/** Реакции и комментарии доступны: не просмотр по ссылке и не черновик (его не видит никто, кроме автора). */
export function annotationsAvailable(): boolean {
  return state.linkMode === null && state.view === 'board' && !onDraft();
}

/**
 * Можно ли ставить реакции и писать комментарии: читатель (SPEC_NIGHT6 §2.3) их видит, но не создаёт.
 * Хаб старой версии возможностей не присылает — тогда как раньше.
 */
export function canAnnotate(): boolean {
  return annotationsAvailable() && myCollabCaps()?.comment !== false;
}

/** Реакция на элемент: через хаб в комнате, у себя — вне её (мимо истории отмены). Ставит или снимает. */
export function toggleReactionOn(elId: string, emoji: string): void {
  if (!canAnnotate()) return;
  if (sendReaction(state.pageId, elId, emoji)) return;
  // читатель без хаба с поддержкой реакций поставить их не может: правка доски ему не положена
  if (!canEditPagesNote()) return;
  replaceElements(state.board.elements.map(e => (e.id === elId ? toggleElementReaction(e, emoji, clientId()) : e)));
}

/** Стоит ли моя реакция emoji на элементе. */
export function hasMyReaction(elId: string, emoji: string): boolean {
  const el = state.board.elements.find(e => e.id === elId);
  const users = el?.reactions && Object.prototype.hasOwnProperty.call(el.reactions, emoji) ? el.reactions[emoji] : null;
  return !!users?.includes(clientId());
}

/** Поставить реакцию (из окна смайлов или ленты недавних): уже стоящая моя — не снимается. */
export function addReaction(elId: string, emoji: string): void {
  if (!emoji || emoji.startsWith('data:') || hasMyReaction(elId, emoji)) return;
  toggleReactionOn(elId, emoji);
  noteRecentReaction(emoji);
}

/** Снять свою реакцию (× на пилюле, удержание, меню «+n»). */
export function removeReaction(elId: string, emoji: string): void {
  if (hasMyReaction(elId, emoji)) toggleReactionOn(elId, emoji);
}

// ----- Нажатия на холсте -----

/**
 * Нажатие по пину ветки без объекта (x, y — экранные координаты холста; пилюли и счётчики объектов — DOM-слой
 * src/annot-layer.ts). true — нажатие обработано, холст его дальше не разбирает.
 */
export function annotationClick(x: number, y: number): boolean {
  if (!annotationsAvailable() || !showComments()) return false;
  const r = host()?.getBoundingClientRect();
  const w = r && r.width > 0 ? r.width : window.innerWidth;
  const h = r && r.height > 0 ? r.height : window.innerHeight;
  const pin = hitPin(layoutPins(state.board.comments, state.board.elements, state.camera, w, h), x, y);
  if (!pin) return false;
  openThread(pin.threadId);
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
  if (!canAnnotate()) return;
  const a = elementAABB(el);
  openPop({ kind: 'new', targetId: el.id, x: a.x1, y: a.y0 });
}

/** Обсуждение объекта: панель у кнопки «Комментировать» (from). */
export function openDiscussion(elId: string, _from?: HTMLElement | null): void {
  const el = state.board.elements.find(e => e.id === elId);
  if (!el || !annotationsAvailable()) return;
  const t = state.board.comments?.find(x => x.targetElementId === elId);
  if (t && !canAnnotate()) openThread(t.id);
  else startComment(el);
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
  // читатель ветку читает, но не отвечает и не закрывает её
  const readOnlyThread = !canAnnotate();
  if (readOnlyThread) make(el, 'div', 'cp-readonly', 'Читатели не пишут комментарии');
  const input = make(el, 'textarea', 'cp-input');
  input.hidden = readOnlyThread;
  input.rows = 2;
  input.maxLength = 2000;
  input.placeholder = st.kind === 'new' ? 'Напишите комментарий…' : 'Ответить…';
  input.spellcheck = false;
  const row = make(el, 'div', 'cp-actions');
  row.hidden = readOnlyThread;
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
  if (readOnlyThread) close.focus();
  else input.focus();
}

/** Правка комментариев: через хаб в комнате, иначе — у себя (мимо истории отмены). */
function change(req: CommentRequest, local: (page: typeof state.board) => typeof state.board): void {
  if (!canAnnotate()) return;
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

