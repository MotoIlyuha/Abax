import type { CommentThread, Element } from './types';
import { onChange, onDraft, replaceElements, state, touchProject, update } from './state';
import { addCommentReply, cleanCommentText, createCommentThread, MAX_COMMENT_TEXT, resolveCommentThread, toggleElementReaction } from './comments';
import { elementAABB } from './geom';
import { canEditPagesNote, noteName, sendComment, sendReaction, type CommentRequest } from './collab-notes';
import { clientId } from './identity';
import { myCollabCaps } from './collab';
import { PIN_R, hitPin, layoutPins } from './annotations';
import { noteRecentReaction, showComments } from './annot-prefs';
import {
  discussionMessages, discussionResolved, elementLabel, elementThreads, replyThread, threadLastAt, type DiscussionMessage,
} from './discussion';
import { createChatComposer, type ChatComposer } from './chat-composer';
import type { ChatSendResult } from './collab-chat';
import { fillChatText, fullTime, isEmojiOnly, timeHM } from './chat-feed';
import { createUserAvatar } from './avatar';
import { notePerson } from './note-people';
import { claimMenu, closeMenu, openMenu, releaseMenu } from './menu-motion';
import { onBoardFrame } from './renderer';

// Интерфейс реакций и комментариев (SPEC_COMMENTS): постановка и снятие реакций, нажатия на пины веток без объекта,
// панель обсуждения объекта. Работает у автора, у участников комнаты (читатель — только читает) и скрыт при просмотре
// по ссылке. Кнопки и пилюли под объектами — src/annot-layer.ts.

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


// ----- Панель обсуждения (SPEC_COMMENTS §3) -----
// Обсуждение объекта — лента как в чате (свои справа акцентом, чужие слева с аватаром, именем цвета плашки и временем)
// и поле ввода чата (src/chat-composer.ts). Выходит из кнопки «Комментировать» по трём уровням анимации
// (src/menu-motion.ts). Ветка без объекта (пин) открывает ту же панель только со своими сообщениями.

type PopState = { kind: 'element'; elId: string } | { kind: 'thread'; id: string };
interface Pop {
  el: HTMLElement;
  state: PopState;
  title: HTMLElement;
  sub: HTMLElement;
  resolve: HTMLButtonElement;
  list: HTMLElement;
  banner: HTMLElement;
  foot: HTMLElement;
  composer: ChatComposer;
  sig: string;
  anchor: HTMLElement | null;
}
let pop: Pop | null = null;

/** Сообщения подряд от одного автора ближе этого — одна группа (как в чате). */
const GROUP_MS = 3 * 60_000;
const RESOLVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
export const READER_COMMENT_TEXT = 'Читатели не пишут комментарии';

function host(): HTMLElement | null {
  return document.getElementById('ctx-layer');
}

function threadOf(id: string): CommentThread | undefined {
  return state.board.comments?.find(t => t.id === id);
}

function make<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement | null, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Ветки, которые показывает панель. */
function popThreads(st: PopState): CommentThread[] {
  if (st.kind === 'element') return elementThreads(state.board.comments, st.elId);
  const t = threadOf(st.id);
  return t ? [t] : [];
}

/** Кнопка «Комментировать» объекта, если его строка сейчас на экране (из неё выходит панель). */
function commentButton(elId: string): HTMLElement | null {
  const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(elId) : elId.replace(/["\\]/g, '\\$&');
  return document.querySelector<HTMLElement>(`#annot-layer .an-row[data-el="${esc}"] .an-comment`);
}

export function closeThread(instant = false): void {
  const p = pop;
  if (!p) return;
  pop = null;
  releaseMenu('discussion');
  p.anchor?.setAttribute('aria-expanded', 'false');
  p.anchor?.classList.remove('open');
  closeMenu(p.el, instant || !p.el.isConnected);
}

export function threadOpen(): boolean {
  return pop !== null;
}

/** Какое обсуждение открыто (для слоя плашек и тестов). */
export function openDiscussionId(): string | null {
  return pop?.state.kind === 'element' ? pop.state.elId : null;
}

/** Обсуждение объекта: панель у его кнопки «Комментировать» (from — откуда она выходит). */
export function openDiscussion(elId: string, from?: HTMLElement | null): void {
  if (!annotationsAvailable() || !state.board.elements.some(e => e.id === elId)) return;
  if (pop?.state.kind === 'element' && pop.state.elId === elId) { closeThread(); return; }
  openPop({ kind: 'element', elId }, from ?? commentButton(elId));
}

/** Новый комментарий к элементу (то же обсуждение). */
export function startComment(el: Element): void {
  openDiscussion(el.id);
}

/** Ветка без объекта (пин) или ветка по id. Ветка при объекте открывает обсуждение объекта. */
export function openThread(id: string): void {
  const t = threadOf(id);
  if (!annotationsAvailable() || !t) return;
  if (t.targetElementId && state.board.elements.some(e => e.id === t.targetElementId)) { openDiscussion(t.targetElementId); return; }
  openPop({ kind: 'thread', id }, null);
}

function openPop(st: PopState, from: HTMLElement | null): void {
  closeThread(true);
  const layer = host();
  if (!layer) return;
  claimMenu('discussion', () => closeThread());
  const el = make(null, 'div', 'comment-pop');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Комментарии');
  el.dataset.ownKeys = '';
  const head = make(el, 'div', 'cp-head');
  const titles = make(head, 'div', 'cp-titles');
  const title = make(titles, 'div', 'cp-title');
  const sub = make(titles, 'div', 'cp-sub');
  const resolve = make(head, 'button', 'cp-icon cp-resolve');
  resolve.type = 'button';
  resolve.innerHTML = RESOLVE_ICON; // константа кода
  resolve.addEventListener('click', () => toggleResolved());
  const close = make(head, 'button', 'cp-icon cp-close');
  close.type = 'button';
  close.title = 'Закрыть (Esc)';
  close.setAttribute('aria-label', 'Закрыть');
  close.innerHTML = CLOSE_ICON; // константа кода
  close.addEventListener('click', () => closeThread());
  const list = make(el, 'div', 'cp-list');
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  const banner = make(el, 'div', 'cp-banner');
  const foot = make(el, 'div', 'cp-foot');
  const composer = createChatComposer({ submit: text => submit(text), maxLength: MAX_COMMENT_TEXT, label: 'Комментарий' });
  // клавиши в панели — её, а не доски (Delete, буквы-инструменты); Esc закрывает панель
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeThread(); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation();
  });
  for (const type of ['pointerdown', 'dblclick', 'contextmenu', 'wheel'] as const) el.addEventListener(type, e => e.stopPropagation());
  document.body.append(el);
  const anchor = from && from.isConnected ? from : null;
  anchor?.setAttribute('aria-expanded', 'true');
  anchor?.classList.add('open');
  pop = { el, state: st, title, sub, resolve, list, banner, foot, composer, sig: '', anchor };
  refresh();
  const p = pop;
  openMenu(el, {
    from: anchor ?? el, pop: anchor, remove: true, place: () => place(p),
    items: () => [...el.querySelectorAll<HTMLElement>(':scope > .cp-head, :scope > .cp-list, :scope > .cp-foot')],
  });
  if (canAnnotate()) composer.focus();
  else close.focus();
}

/** Правка комментариев: через хаб в комнате, иначе — у себя (мимо истории отмены). */
function change(req: CommentRequest, local: (page: typeof state.board) => typeof state.board): boolean {
  if (!canAnnotate()) return false;
  if (sendComment(state.pageId, req)) return true;
  if (!canEditPagesNote()) return false;
  const next = local(state.board);
  if (next === state.board) return false;
  if (next.comments) state.board.comments = next.comments;
  else delete state.board.comments;
  touchProject();
  update();
  return true;
}

function submit(raw: string): ChatSendResult {
  const p = pop;
  if (!p) return 'empty';
  const text = cleanCommentText(raw);
  if (!text) return 'empty';
  if (!canAnnotate()) return 'readonly';
  const author = { authorId: clientId(), authorName: noteName() };
  let ok: boolean;
  if (p.state.kind === 'thread') {
    const id = p.state.id;
    ok = change({ op: 'reply', threadId: id, text }, page => addCommentReply(page, id, { ...author, text }));
  } else {
    const elId = p.state.elId;
    const target = replyThread(elementThreads(state.board.comments, elId));
    if (target) {
      ok = change({ op: 'reply', threadId: target.id, text }, page => addCommentReply(page, target.id, { ...author, text }));
    } else {
      const el = state.board.elements.find(e => e.id === elId);
      if (!el) return 'empty';
      // точка новой ветки — правый верхний угол объекта (её видят старые версии как пин)
      const a = elementAABB(el);
      ok = change({ op: 'create', x: a.x1, y: a.y0, targetElementId: elId, text },
        page => createCommentThread(page, { x: a.x1, y: a.y0, targetElementId: elId, ...author, text }));
    }
  }
  return ok ? 'ok' : 'offline';
}

/** «Решено» закрывает все открытые ветки обсуждения; «Вернуть в обсуждение» открывает последнюю. */
function toggleResolved(): void {
  const p = pop;
  if (!p) return;
  const threads = popThreads(p.state);
  if (!threads.length) return;
  if (discussionResolved(threads)) {
    const last = threads.reduce((a, b) => (threadLastAt(b) >= threadLastAt(a) ? b : a));
    change({ op: 'resolve', threadId: last.id, resolved: false }, page => resolveCommentThread(page, last.id, false));
    return;
  }
  for (const t of threads) {
    if (t.resolved) continue;
    change({ op: 'resolve', threadId: t.id, resolved: true }, page => resolveCommentThread(page, t.id, true));
  }
}

/** Лента сообщений: группы по автору (как в чате), свои — справа. */
function renderMessages(p: Pop, msgs: readonly DiscussionMessage[], fresh: ReadonlySet<string>): void {
  p.list.textContent = '';
  const me = clientId();
  let prev: DiscussionMessage | null = null;
  for (const m of msgs) {
    const mine = m.authorId === me;
    const grouped = !!prev && prev.authorId === m.authorId && m.createdAt - prev.createdAt < GROUP_MS;
    const row = make(p.list, 'div', `cp-msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}${m.resolved ? ' resolved' : ''}${fresh.has(m.id) ? ' cp-new' : ''}`);
    row.dataset.id = m.id;
    if (!mine) {
      const who = notePerson(m.authorId);
      const name = m.authorName || who.name;
      const slot = make(row, 'div', 'cp-avatar');
      if (!grouped) {
        const av = createUserAvatar({ name, bg: who.bg, fg: who.fg, cursorId: who.cursorId ?? null, avatar: who.avatar ?? null, status: 'online' }, 'cp-ua');
        av.tabIndex = -1;
        slot.append(av);
      }
    }
    const body = make(row, 'div', 'cp-body');
    if (!grouped) {
      const meta = make(body, 'div', 'cp-meta');
      if (!mine) {
        const who = notePerson(m.authorId);
        const author = make(meta, 'span', 'cp-author', m.authorName || who.name);
        author.style.color = who.bg;
      }
      const time = make(meta, 'time', 'cp-time', timeHM(m.createdAt));
      time.title = fullTime(m.createdAt);
    }
    const bubble = make(body, 'div', `cp-text${isEmojiOnly(m.text) ? ' emoji' : ''}`);
    bubble.title = fullTime(m.createdAt);
    fillChatText(bubble, m.text);
    prev = m;
  }
}

/** Перерисовка панели: пропала ветка или объект — закрыть; изменился состав — пересобрать; всегда — положение. */
function refresh(): void {
  const p = pop;
  if (!p) return;
  if (!annotationsAvailable()) { closeThread(); return; }
  if (p.state.kind === 'element') {
    const id = p.state.elId;
    if (!state.board.elements.some(e => e.id === id)) { closeThread(); return; }
  } else if (!threadOf(p.state.id)) { closeThread(); return; }
  const threads = popThreads(p.state);
  const msgs = discussionMessages(threads);
  const resolved = discussionResolved(threads);
  const can = canAnnotate();
  const sig = JSON.stringify([msgs.map(m => m.id), resolved, can]);
  if (sig !== p.sig) {
    const before = new Set(p.sig ? (JSON.parse(p.sig) as [string[]])[0] : msgs.map(m => m.id));
    p.sig = sig;
    const el = p.state.kind === 'element' ? state.board.elements.find(e => e.id === (p.state as { elId: string }).elId) : undefined;
    p.title.textContent = msgs.length === 0 ? 'Новый комментарий' : `Комментарии · ${msgs.length}`;
    p.sub.textContent = p.state.kind === 'element' ? elementLabel(el) : 'Комментарий на доске';
    p.resolve.hidden = msgs.length === 0 || !can;
    p.resolve.classList.toggle('on', resolved);
    p.resolve.title = resolved ? 'Вернуть в обсуждение' : 'Отметить как решённое';
    p.resolve.setAttribute('aria-label', p.resolve.title);
    p.resolve.setAttribute('aria-pressed', String(resolved));
    p.el.classList.toggle('resolved', resolved);
    p.el.classList.toggle('empty', msgs.length === 0);
    const fresh = new Set(msgs.filter(m => !before.has(m.id)).map(m => m.id));
    renderMessages(p, msgs, fresh);
    p.banner.textContent = '';
    p.banner.hidden = !resolved;
    if (resolved) {
      make(p.banner, 'span', 'cp-banner-text', 'Обсуждение решено');
      if (can) {
        const back = make(p.banner, 'button', 'cp-banner-btn', 'Вернуть');
        back.type = 'button';
        back.addEventListener('click', () => toggleResolved());
      }
    }
    p.foot.textContent = '';
    if (can) p.foot.append(p.composer.el);
    else make(p.foot, 'div', 'cp-readonly', READER_COMMENT_TEXT);
    p.composer.input.placeholder = msgs.length === 0 ? 'Напишите комментарий…' : resolved ? 'Новое сообщение вернёт обсуждение' : 'Ответить…';
    p.list.scrollTop = p.list.scrollHeight;
  }
  if (!p.el.classList.contains('mm-morph')) place(p);
}

/** Под кнопкой «Комментировать» (правым краем к ней), не влезает — над ней; без кнопки — у угла объекта. */
function place(p: Pop): void {
  if (p.anchor && !p.anchor.isConnected && p.state.kind === 'element') p.anchor = commentButton(p.state.elId);
  const w = p.el.offsetWidth || 320;
  const h = p.el.offsetHeight || 240;
  const m = 8;
  let ay0: number, ax1: number, ay1: number;
  const r = p.anchor?.getBoundingClientRect();
  if (r && (r.width || r.height)) {
    ay0 = r.top; ax1 = r.right; ay1 = r.bottom;
  } else {
    const wrap = document.getElementById('canvas-wrap')?.getBoundingClientRect();
    const cam = state.camera;
    let pt = { x: 0, y: 0 };
    if (p.state.kind === 'element') {
      const id = p.state.elId;
      const el = state.board.elements.find(e => e.id === id);
      if (el) { const a = elementAABB(el); pt = { x: a.x1, y: a.y1 }; }
    } else {
      const t = threadOf(p.state.id);
      if (t) pt = { x: t.x + PIN_R / cam.zoom, y: t.y };
    }
    ax1 = (wrap?.left ?? 0) + (pt.x - cam.x) * cam.zoom;
    ay0 = ay1 = (wrap?.top ?? 0) + (pt.y - cam.y) * cam.zoom;
  }
  let left = ax1 - w;
  let top = ay1 + 8;
  if (top + h > window.innerHeight - m && ay0 - 8 - h >= m) top = ay0 - 8 - h;
  left = Math.max(m, Math.min(left, window.innerWidth - w - m));
  top = Math.max(m, Math.min(top, window.innerHeight - h - m));
  p.el.style.left = `${Math.round(left)}px`;
  p.el.style.top = `${Math.round(top)}px`;
}

let inited = false;

/** Подключает слежение за состоянием, кадрами холста и закрытие панели по Esc и нажатию мимо. */
export function initCommentsUi(): void {
  onChange(refresh);
  if (inited) return;
  inited = true;
  onBoardFrame(() => { if (pop && !pop.el.classList.contains('mm-morph')) place(pop); });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && pop && !(e.target instanceof Node && pop.el.contains(e.target))) { e.stopPropagation(); closeThread(); }
  }, true);
  document.addEventListener('pointerdown', e => {
    const t = e.target as HTMLElement | null;
    // нажатие по кнопке «Комментировать» решает она сама (откроет другое обсуждение или закроет это);
    // по пину откроет ветку annotationClick; остальное — закрывает
    if (pop && !(t instanceof Node && pop.el.contains(t)) && !t?.closest?.('.an-comment, #icon-picker')) closeThread();
  }, true);
}
