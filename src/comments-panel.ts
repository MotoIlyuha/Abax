// Вкладка «Комментарии» режима ЧКУ (SPEC_COMMENTS §6): карточки обсуждений объектов проекта.
//  • Карточка — объект (или ветка без объекта): подпись объекта, страница (если не текущая), «Перейти»; реакции
//    (пилюли цвета плашки первого поставившего, подсказка — кто); последние сообщения (до PREVIEW_MAX, «Показать
//    все»); «Ответить» — переход к объекту и панель обсуждения у него. Решённое обсуждение — бледнее, с отметкой.
//  • Порядок: сначала текущая страница, внутри — по последнему сообщению (свежие выше), объекты только с реакциями —
//    после обсуждений, в порядке доски.
//  • Непрочитанное (чужой комментарий или реакция, уведомление ещё не прочитано на момент открытия) — точка.
// Имена и тексты — только textContent (ссылки — как в чате, fillChatText); SVG — константы кода.

import { state } from './state';
import type { CommentThread, Element, Page } from './types';
import { detachedThreads, discussionMessages, discussionResolved, elementLabel, elementThreads, threadLastAt } from './discussion';
import { notePerson, peopleLabel } from './note-people';
import { fillChatText, fullTime, timeHM } from './chat-feed';
import { createUserAvatar } from './avatar';
import { canAnnotate, openDiscussion, openThread } from './comments-ui';
import { goToBoardPage, showBoardObjects } from './chat-attach-view';
import { animateCameraTo } from './camera-anim';
import { attachOverlayScroll, type OverlayScroll } from './overlay-scroll';
import { COMMENT_ICON } from './icons';
import { clientId } from './identity';

/** Сколько последних сообщений видно в свёрнутой карточке. */
export const PREVIEW_MAX = 3;
export const COMMENTS_EMPTY_TEXT = 'Комментариев пока нет — выделите объект и нажмите «Комментировать»';

const GOTO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M9 7h8v8"/></svg>';

export interface CommentCard {
  /** Ключ карточки: e:<pageId>:<elId> — объект, t:<pageId>:<threadId> — ветка без объекта. */
  key: string;
  pageId: string;
  pageName: string;
  elId?: string;
  threadId?: string;
  label: string;
  threads: CommentThread[];
  reactions: [string, string[]][];
  /** Время последнего сообщения (0 — только реакции). */
  last: number;
  /** Порядок объекта на странице (для карточек только с реакциями). */
  order: number;
}

/** Карточки проекта: чистый расчёт (для вида и тестов). */
export function commentCards(pages: readonly Page[], currentPageId: string): CommentCard[] {
  const out: CommentCard[] = [];
  const ordered = [...pages].sort((a, b) => (a.id === currentPageId ? -1 : b.id === currentPageId ? 1 : 0));
  for (const pg of ordered) {
    const cards: CommentCard[] = [];
    pg.elements.forEach((el: Element, i) => {
      const threads = elementThreads(pg.comments, el.id);
      const reactions = el.reactions ? Object.entries(el.reactions).filter(([, u]) => u.length > 0) : [];
      if (!threads.length && !reactions.length) return;
      cards.push({
        key: `e:${pg.id}:${el.id}`, pageId: pg.id, pageName: pg.name, elId: el.id, label: elementLabel(el), threads, reactions,
        last: Math.max(0, ...threads.map(threadLastAt)), order: i,
      });
    });
    for (const t of detachedThreads(pg.comments, pg.elements)) {
      cards.push({
        key: `t:${pg.id}:${t.id}`, pageId: pg.id, pageName: pg.name, threadId: t.id, label: 'Комментарий на доске', threads: [t], reactions: [],
        last: threadLastAt(t), order: Number.MAX_SAFE_INTEGER,
      });
    }
    cards.sort((a, b) => (b.last - a.last) || (a.order - b.order));
    out.push(...cards);
  }
  return out;
}

/** Ключ карточки для уведомления о комментарии или реакции. */
export function cardKeyOf(ref: { pageId: string; elId?: string; threadId?: string }): string {
  return ref.elId ? `e:${ref.pageId}:${ref.elId}` : `t:${ref.pageId}:${ref.threadId ?? ''}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Перейти к объекту карточки (страница, кадр, вспышка). */
async function goTo(c: CommentCard): Promise<boolean> {
  if (c.elId) return showBoardObjects({ pageId: c.pageId, ids: [c.elId] });
  if (!(await goToBoardPage(c.pageId))) return false;
  const t = state.board.comments?.find(x => x.id === c.threadId);
  if (!t) return false;
  animateCameraTo(t.x, t.y);
  return true;
}

export interface CommentsView {
  readonly el: HTMLElement;
  /** Перерисовать, если данные изменились (force — всё равно). */
  render(force?: boolean): void;
  /** Карточки, у которых точка «не прочитано». */
  setUnread(keys: ReadonlySet<string>): void;
  /** Прокрутить к карточке и подсветить её; false — карточки нет. */
  reveal(key: string): boolean;
  dispose(): void;
}

export function createCommentsView(): CommentsView {
  const root = el('div', 'cm');
  const frame = el('div', 'cm-frame');
  const list = el('div', 'cm-list');
  list.setAttribute('role', 'feed');
  list.setAttribute('aria-label', 'Комментарии к объектам');
  frame.append(list);
  const empty = el('div', 'np-empty cm-empty');
  const icon = el('span', 'np-empty-icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = COMMENT_ICON; // константа кода
  empty.append(icon, el('div', 'np-empty-text', COMMENTS_EMPTY_TEXT));
  root.append(frame, empty);
  let overlay: OverlayScroll | null = null;
  let refs: unknown[] = [];
  let unread: ReadonlySet<string> = new Set();
  const expanded = new Set<string>();

  /** Данные не менялись: те же массивы элементов и комментариев страниц, та же текущая страница. */
  const sameRefs = (): boolean => {
    const next: unknown[] = [state.pageId, canAnnotate()];
    for (const pg of state.project.pages) next.push(pg.id, pg.name, pg.elements, pg.comments);
    const same = next.length === refs.length && next.every((v, i) => v === refs[i]);
    refs = next;
    return same;
  };

  const card = (c: CommentCard): HTMLElement => {
    const msgs = discussionMessages(c.threads);
    const resolved = discussionResolved(c.threads);
    const box = el('article', `cm-card${resolved ? ' resolved' : ''}${unread.has(c.key) ? ' unread' : ''}`);
    box.dataset.key = c.key;
    const head = el('div', 'cm-head');
    const titles = el('div', 'cm-titles');
    titles.append(el('div', 'cm-label', c.label));
    const meta: string[] = [];
    if (c.pageId !== state.pageId) meta.push(`«${c.pageName}»`);
    if (msgs.length) meta.push(`${msgs.length} ${plural(msgs.length, 'сообщение', 'сообщения', 'сообщений')}`);
    if (resolved) meta.push('решено');
    if (meta.length) titles.append(el('div', 'cm-meta', meta.join(' · ')));
    const go = el('button', 'cm-go');
    go.type = 'button';
    go.title = 'Перейти к объекту';
    go.setAttribute('aria-label', `Перейти: ${c.label}`);
    go.innerHTML = GOTO_ICON; // константа кода
    go.addEventListener('click', () => { void goTo(c); });
    head.append(titles, go);
    box.append(head);
    if (unread.has(c.key)) {
      const dot = el('span', 'np-dot');
      dot.title = 'Не прочитано';
      box.append(dot);
    }
    if (c.reactions.length) {
      const row = el('div', 'cm-reactions');
      const me = clientId();
      for (const [emoji, users] of c.reactions) {
        const p = notePerson(users[0]);
        const chip = el('span', `cm-pill${users.includes(me) ? ' mine' : ''}`);
        chip.style.setProperty('--an-bg', p.bg);
        chip.style.setProperty('--an-fg', p.fg);
        chip.title = peopleLabel(users, 8);
        chip.append(el('span', 'cm-pill-emoji', emoji), el('span', 'cm-pill-num', String(users.length)));
        row.append(chip);
      }
      box.append(row);
    }
    if (msgs.length) {
      const body = el('div', 'cm-msgs');
      const open = expanded.has(c.key);
      const shown = open ? msgs : msgs.slice(-PREVIEW_MAX);
      if (!open && msgs.length > PREVIEW_MAX) {
        const more = el('button', 'cm-more', `Показать все (${msgs.length})`);
        more.type = 'button';
        more.addEventListener('click', () => { expanded.add(c.key); render(true); });
        body.append(more);
      }
      for (const m of shown) {
        const who = notePerson(m.authorId);
        const name = m.authorId === clientId() ? 'Вы' : m.authorName || who.name;
        const row = el('div', 'cm-msg');
        const av = createUserAvatar({ name: m.authorName || who.name, bg: who.bg, fg: who.fg, cursorId: who.cursorId ?? null, avatar: who.avatar ?? null, status: 'online' }, 'cm-ua');
        av.tabIndex = -1;
        av.removeAttribute('title');
        const main = el('div', 'cm-msg-main');
        const line = el('div', 'cm-msg-meta');
        const author = el('span', 'cm-author', name);
        author.style.color = who.bg;
        const time = el('time', 'cm-time', timeHM(m.createdAt));
        time.title = fullTime(m.createdAt);
        line.append(author, time);
        const text = el('div', 'cm-text');
        fillChatText(text, m.text);
        main.append(line, text);
        row.append(av, main);
        body.append(row);
      }
      box.append(body);
    }
    if (canAnnotate() || msgs.length) {
      const foot = el('div', 'cm-foot');
      const reply = el('button', 'cm-reply', canAnnotate() ? (msgs.length ? 'Ответить' : 'Комментировать') : 'Открыть обсуждение');
      reply.type = 'button';
      reply.addEventListener('click', () => {
        void goTo(c).then(ok => {
          if (!ok || state.pageId !== c.pageId) return;
          if (c.elId) openDiscussion(c.elId);
          else if (c.threadId) openThread(c.threadId);
        });
      });
      foot.append(reply);
      box.append(foot);
    }
    return box;
  };

  const render = (force = false): void => {
    if (sameRefs() && !force) return;
    const cards = commentCards(state.project.pages, state.pageId);
    const top = list.scrollTop;
    list.textContent = '';
    let page = '';
    const many = new Set(cards.map(c => c.pageId)).size > 1;
    for (const c of cards) {
      if (many && c.pageId !== page) {
        page = c.pageId;
        const h = el('div', 'np-day cm-page', c.pageId === state.pageId ? `Эта страница · «${c.pageName}»` : `«${c.pageName}»`);
        h.setAttribute('role', 'heading');
        h.setAttribute('aria-level', '3');
        list.append(h);
      }
      list.append(card(c));
    }
    list.scrollTop = top;
    frame.hidden = cards.length === 0;
    empty.hidden = cards.length > 0;
    if (!overlay && list.isConnected) overlay = attachOverlayScroll(list, { axis: 'y', host: frame });
    overlay?.sync();
  };

  return {
    el: root,
    render,
    setUnread(keys) {
      const changed = keys.size !== unread.size || [...keys].some(k => !unread.has(k));
      unread = new Set(keys);
      if (changed) render(true);
    },
    reveal(key) {
      render();
      const target = [...list.querySelectorAll<HTMLElement>('.cm-card')].find(n => n.dataset.key === key);
      if (!target) return false;
      target.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      target.classList.remove('cm-flash');
      void target.offsetWidth;
      target.classList.add('cm-flash');
      window.setTimeout(() => target.classList.remove('cm-flash'), 1700);
      return true;
    },
    dispose() { overlay?.destroy(); overlay = null; },
  };
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
