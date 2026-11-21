// Режим «Чат, комментарии и уведомления» (ЧКУ) правой боковой панели (SPEC_CHAT §6, SPEC_COMMENTS §6). Каркас панели
// (src/side-panel.ts) монтирует вид в свой контейнер и показывает/скрывает его; действия режима («Не беспокоить»,
// «Прочитать всё») — в шапке панели. В переключателе режимов — два пункта: «Чат и уведомления» (вкладка «Все») и
// «Комментарии» (вкладка «Комментарии»).
//  • Под шапкой — вкладки Tab pill (src/tab-pill.ts): «Все», «Чат», «Комментарии», «Уведомления»; у трёх последних —
//    число непрочитанных. Вкладка запоминается в localStorage['doska.notifyTab'].
//  • «Все» — лента сообщений, событий комментариев и системных событий по времени, «Чат» — только сообщения
//    (src/chat-feed.ts); у обеих внизу поле ввода (src/chat-composer.ts). «Комментарии» — карточки обсуждений
//    объектов (src/comments-panel.ts). «Уведомления» — карточки системных событий (src/notice-card.ts) по дням.
//  • Правила прочтения: пока вид показан, вкладка «Все» помечает прочитанным всё, «Чат» — чат, «Комментарии» —
//    комментарии и реакции, «Уведомления» — системные. Линия «Новые» — над первым непрочитанным на момент открытия.
//  • Без совместной работы — «Чат появится, когда к доске подключатся участники» и «Поделиться» (только у автора);
//    читатель — «Читатели не пишут в чат», поля нет.
// Имена и тексты участников — только textContent; SVG — константы кода.

import { COMMENT_ICON, NOTIFY_ICON, NOTICE_ICONS, notifyTabIcon } from './icons';
import { cardKeyOf, createCommentsView, type CommentsView } from './comments-panel';
import { onChange } from './state';
import { setPanelTabIcon } from './side-panel';
import {
  clearNotices, doNotDisturb, markNoticeRead, markRead, notices, onNotices, setDoNotDisturb, unreadCount, type Notice,
} from './notify-center';
import {
  READER_CHAT_TEXT, chatAvailable, chatCanWrite, chatMessages, chatMyId, onChat, sendChatMessage, setChatVisible,
} from './collab-chat';
import { createTabPill, type TabPill } from './tab-pill';
import { createChatFeed, dayLabel, type ChatFeed, type FeedItem } from './chat-feed';
import { createChatComposer, type ChatComposer } from './chat-composer';
import { attachComposerTools, chatDraft, setChatDraft, type ComposerAttachTools } from './chat-attach';
import { noticeContent, paintNoticeTime } from './notice-card';
import { attachOverlayScroll, type OverlayScroll } from './overlay-scroll';
import { S, register, step, tune, wake, type Spring } from './motion';
import { menuMotion } from './menu-motion';
import { state } from './state';
import type { PanelModeDef, PanelView } from './panel-types';

export const NOTIFY_MODE: Omit<PanelModeDef, 'mount'> = { id: 'notify', label: 'Чат и уведомления', icon: NOTIFY_ICON };
/** Пункт «Комментарии» переключателя режимов: тот же режим ЧКУ на вкладке «Комментарии». */
export const COMMENTS_ENTRY = { label: 'Комментарии', icon: COMMENT_ICON };

/** Вкладки режима ЧКУ. */
export type NotifyTab = 'all' | 'chat' | 'comments' | 'notices';

/** Ключ запомненной вкладки (режим панели каркас хранит отдельно — в doska.sidePanel). */
export const NOTIFY_TAB_KEY = 'doska.notifyTab';
export const NOTIFY_OFF_TEXT = 'Чат появится, когда к доске подключатся участники';
export const NOTIFY_QUIET_TEXT = 'Пока тихо - здесь появятся события доски';
export const DND_TITLE_OFF = 'Не беспокоить: уведомления не будут всплывать';
export const DND_TITLE_ON = 'Не беспокоить включено - уведомления не всплывают';

const TABS: readonly { value: NotifyTab; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'chat', label: 'Чат' },
  { value: 'comments', label: 'Комментарии' },
  { value: 'notices', label: 'Уведомления' },
];

/** Полумесяц-контур (заливается при включении «Не беспокоить», как луна в образце Focus mode). */
const MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/><path d="M17 3.5v3M15.5 5h3"/></svg>';
/** «Прочитать всё»: двойная галочка. */
const READ_ALL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12.5l4.5 4.5L17 7"/><path d="M12 16.5l.5.5L22 7.5"/></svg>';

const isTab = (v: unknown): v is NotifyTab => v === 'all' || v === 'chat' || v === 'comments' || v === 'notices';

function loadTab(): NotifyTab {
  try {
    const v = localStorage.getItem(NOTIFY_TAB_KEY);
    if (isTab(v)) return v;
  } catch { /* хранилище недоступно */ }
  return 'all';
}

function saveTab(t: NotifyTab): void {
  try { localStorage.setItem(NOTIFY_TAB_KEY, t); } catch { /* хранилище недоступно — только в памяти */ }
}

let tab: NotifyTab = loadTab();
let shown = false;
let pendingReveal: string | null = null;

interface View {
  pill: TabPill;
  openTab(): void;
  reveal(id: string): boolean;
  revealCard(key: string): boolean;
}
let pendingCard: string | null = null;
let view: View | null = null;
let unsubs: (() => void)[] = [];

/** Текущая вкладка (запоминается и до монтирования вида). */
export function notifyTab(): NotifyTab {
  return tab;
}

/** Переключить вкладку; показанный вид сразу помечает прочитанным то, что на ней видно. */
export function setNotifyTab(next: NotifyTab): void {
  if (!isTab(next)) return;
  const changed = next !== tab;
  tab = next;
  saveTab(next);
  setPanelTabIcon(notifyTabIcon(next));
  document.dispatchEvent(new CustomEvent('doska:notify-tab'));
  if (!view) return;
  view.pill.setValue(next);
  if (changed || shown) view.openTab();
}

/** Перейти к сообщению чата: вкладка, где оно видно, прокрутка к нему и мягкая подсветка. */
export function revealChatMessage(id: string): void {
  if (tab !== 'all' && tab !== 'chat') setNotifyTab('chat');
  if (view && shown) {
    if (!view.reveal(id)) pendingReveal = null;
  } else pendingReveal = id;
}

/** Перейти к обсуждению объекта: вкладка «Комментарии», прокрутка к карточке и подсветка. */
export function revealCommentCard(ref: { pageId: string; elId?: string; threadId?: string }): void {
  const key = cardKeyOf(ref);
  setNotifyTab('comments');
  if (view && shown) view.revealCard(key);
  else pendingCard = key;
}

/** Пометить прочитанным то, что видно на вкладке, и сообщить чату, видна ли его лента. */
function markShown(): void {
  setChatVisible(shown && (tab === 'all' || tab === 'chat'));
  if (!shown) return;
  if (tab === 'all') markRead();
  else markRead(tab === 'chat' ? 'chat' : tab === 'comments' ? 'comment' : 'system');
}

// ----- Данные лент -----

function chatItems(): FeedItem[] {
  return chatMessages().map(m => ({ kind: 'msg' as const, id: m.id, ts: m.ts, m }));
}

function systemNotices(): Notice[] {
  return notices().filter(n => n.kind === 'system');
}

/** События ленты «Все»: системные, комментарии и реакции. */
function feedNotices(): Notice[] {
  return notices().filter(n => n.kind !== 'chat');
}

/** «Все»: сообщения, события комментариев и системные события по времени (при равном времени — сообщения раньше). */
function allItems(): FeedItem[] {
  const out: FeedItem[] = chatItems();
  for (const n of feedNotices()) out.push({ kind: 'event', id: n.id, ts: n.ts, n });
  return out.sort((a, b) => a.ts - b.ts);
}

/** Первый непрочитанный элемент ленты (до пометки прочитанным). */
function firstUnread(items: FeedItem[]): string | null {
  const chat = new Set<string>();
  for (const n of notices()) if (!n.read && n.kind === 'chat' && n.chatId) chat.add(n.chatId);
  for (const it of items) {
    if (it.kind === 'msg' ? chat.has(it.id) : !it.n.read) return it.id;
  }
  return null;
}

/** Окно «Поделиться» открывает только автор: не просмотр по ссылке, не гость, кнопка в шапке есть и видна. */
function canShare(): boolean {
  const btn = document.getElementById('btn-share');
  return !!btn && btn.style.display !== 'none' && state.linkMode === null && state.collabRole !== 'guest';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Пустое состояние: иконка в круге, текст и необязательная кнопка. */
function emptyState(icon: string, text: string, compact = false): HTMLElement {
  const box = el('div', `np-empty${compact ? ' np-empty-compact' : ''}`);
  const i = el('span', 'np-empty-icon');
  i.setAttribute('aria-hidden', 'true');
  i.innerHTML = icon; // константа кода
  box.append(i, el('div', 'np-empty-text', text));
  return box;
}

/** «Чат появится…» и «Поделиться» (только у автора). */
function offState(compact = false): HTMLElement {
  const box = emptyState(NOTIFY_ICON, NOTIFY_OFF_TEXT, compact);
  if (canShare()) {
    const b = el('button', 'np-share', 'Поделиться');
    b.type = 'button';
    b.title = 'Пригласить участников на доску';
    b.addEventListener('click', () => document.getElementById('btn-share')?.click());
    box.append(b);
  }
  return box;
}

// ----- «Не беспокоить»: щелчок луны («Улучшенные») -----

const MS: Spring = S(1);
const MR: Spring = S(0);
let moonEl: HTMLElement | null = null;
let moonLoop = false;
let moonMoving = false;

function kickMoon(icon: HTMLElement): void {
  const mode = menuMotion();
  if (mode === 'off') return;
  if (mode === 'normal') {
    icon.classList.remove('np-moon-pop');
    void icon.offsetWidth;
    icon.classList.add('np-moon-pop');
    icon.addEventListener('animationend', () => icon.classList.remove('np-moon-pop'), { once: true });
    return;
  }
  moonEl = icon;
  tune(MS, 520, 16);
  tune(MR, 420, 14);
  MS.x = 0.78; MS.v = 0; MS.t = 1;
  MR.x = -22; MR.v = 0; MR.t = 0;
  moonMoving = true;
  if (!moonLoop) {
    moonLoop = true;
    register({
      frame(dt) { if (moonMoving) { step(MS, dt); step(MR, dt); } },
      render() {
        if (!moonMoving || !moonEl) return;
        const done = !moonEl.isConnected || (Math.abs(MS.x - 1) < 0.002 && Math.abs(MS.v) < 0.02 && Math.abs(MR.x) < 0.05 && Math.abs(MR.v) < 0.3);
        if (done) { moonMoving = false; moonEl.style.removeProperty('transform'); return; }
        moonEl.style.transform = `rotate(${MR.x.toFixed(2)}deg) scale(${MS.x.toFixed(4)})`;
      },
      settled: () => !moonMoving,
    });
  }
  wake();
}

// ----- Вид -----

export function mountNotifyPanel(host: HTMLElement): PanelView {
  for (const u of unsubs) u();
  unsubs = [];
  const root = el('div', 'np');
  const pill = createTabPill({
    tabs: TABS.map(t => ({ ...t, id: `np-tab-${t.value}`, controls: `np-view-${t.value}` })),
    value: tab,
    label: 'Разделы чата и уведомлений',
    className: 'np-tabs',
    onChange: v => setNotifyTab(v as NotifyTab),
  });
  const tabsRow = el('div', 'np-tabs-row');
  tabsRow.append(pill.el);

  const feeds: Record<'all' | 'chat', ChatFeed> = {
    all: createChatFeed({ items: allItems, me: chatMyId, label: 'Сообщения и события' }),
    chat: createChatFeed({ items: chatItems, me: chatMyId, label: 'Сообщения чата' }),
  };
  const panels = {} as Record<NotifyTab, HTMLElement>;
  const views = el('div', 'np-views');
  for (const t of TABS) {
    const p = el('div', `np-view np-view-${t.value}`);
    p.id = `np-view-${t.value}`;
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', `np-tab-${t.value}`);
    panels[t.value] = p;
    views.append(p);
  }
  panels.all.append(feeds.all.el);
  panels.chat.append(feeds.chat.el);
  const comments: CommentsView = createCommentsView();
  panels.comments.append(comments.el);
  unsubs.push(() => comments.dispose());
  /** Карточки с непрочитанным на момент открытия вкладки и пришедшим при ней. */
  const freshCards = new Set<string>();
  const unreadCards = (): Set<string> => {
    const out = new Set(freshCards);
    for (const n of notices()) if (n.kind === 'comment' && !n.read && n.ref) out.add(cardKeyOf(n.ref));
    return out;
  };
  unsubs.push(onChange(() => { if (shown && tab === 'comments') comments.render(); }));

  // «Уведомления»: строка с «Очистить», карточки по дням, пустое состояние
  const noticesBar = el('div', 'np-notices-bar');
  const noticesTitle = el('span', 'np-notices-title');
  const clear = el('button', 'np-clear', 'Очистить');
  clear.type = 'button';
  clear.title = 'Убрать все системные уведомления';
  clear.addEventListener('click', () => clearNotices('system'));
  noticesBar.append(noticesTitle, clear);
  const noticesFrame = el('div', 'np-notices-frame');
  const noticesScroll = el('div', 'np-notices');
  noticesFrame.append(noticesScroll);
  const noticesEmpty = emptyState(NOTICE_ICONS.bell, NOTIFY_QUIET_TEXT);
  panels.notices.append(noticesBar, noticesFrame, noticesEmpty);
  let noticesOverlay: OverlayScroll | null = null;
  /** Непрочитанные на момент открытия вкладки и пришедшие при ней: точка держится, пока вкладка открыта. */
  const fresh = new Set<string>();

  const composer: ChatComposer = createChatComposer({
    submit: text => {
      const r = sendChatMessage(text, chatDraft()?.att);
      if (r === 'ok') setChatDraft(null);
      return r;
    },
  });
  // кнопки вложений, вставка картинки в поле и перетаскивание на панель (SPEC_CHAT §7)
  const attach: ComposerAttachTools = attachComposerTools(composer);
  unsubs.push(() => attach.dispose());
  const composeSlot = el('div', 'np-compose');
  root.append(tabsRow, views, composeSlot);
  host.append(root);
  attach.dropZone(root, () => chatAvailable() && chatCanWrite());
  root.addEventListener('drop', () => { if (tab === 'notices' && chatAvailable() && chatCanWrite()) setNotifyTab('chat'); });

  // действия режима для шапки панели
  const actions = el('div', 'np-actions');
  const dnd = el('button', 'np-act np-dnd');
  dnd.type = 'button';
  dnd.setAttribute('aria-label', 'Не беспокоить');
  const moon = el('span', 'np-moon');
  moon.setAttribute('aria-hidden', 'true');
  moon.innerHTML = MOON_ICON; // константа кода
  dnd.append(moon);
  dnd.addEventListener('click', () => {
    setDoNotDisturb(!doNotDisturb());
    kickMoon(moon);
  });
  const readAll = el('button', 'np-act np-read-all');
  readAll.type = 'button';
  readAll.title = 'Прочитать всё';
  readAll.setAttribute('aria-label', 'Прочитать всё');
  readAll.innerHTML = READ_ALL_ICON; // константа кода
  readAll.addEventListener('click', () => markRead());
  actions.append(dnd, readAll);

  const renderDnd = () => {
    const on = doNotDisturb();
    dnd.setAttribute('aria-pressed', String(on));
    dnd.title = on ? DND_TITLE_ON : DND_TITLE_OFF;
    dnd.classList.toggle('on', on);
  };

  const renderCounts = () => {
    pill.setCount('chat', unreadCount('chat'));
    pill.setCount('comments', unreadCount('comment'));
    pill.setCount('notices', unreadCount('system'));
    readAll.disabled = unreadCount() === 0;
  };

  /** Поле ввода, заметка читателя или «чат появится…» под лентой. */
  const renderCompose = () => {
    composeSlot.textContent = '';
    composeSlot.hidden = true;
    if (tab === 'notices' || tab === 'comments') return;
    if (!chatAvailable()) {
      // в «Все» с событиями лента не пуста — заметка о чате внизу вместо поля
      if (tab === 'all' && feedNotices().length) {
        composeSlot.append(offState(true));
        composeSlot.hidden = false;
      }
      return;
    }
    composeSlot.hidden = false;
    if (!chatCanWrite()) composeSlot.append(el('div', 'np-reader', READER_CHAT_TEXT));
    else composeSlot.append(composer.el);
  };

  const renderEmpties = () => {
    feeds.all.setEmpty(chatAvailable() ? emptyState(NOTIFY_ICON, 'Сообщений и событий пока нет') : offState());
    feeds.chat.setEmpty(chatAvailable() ? emptyState(NOTIFY_ICON, 'Сообщений пока нет - напишите первым') : offState());
  };

  const renderNotices = () => {
    const list = systemNotices().slice().reverse();
    noticesScroll.textContent = '';
    noticesBar.hidden = !list.length;
    noticesFrame.hidden = !list.length;
    noticesEmpty.hidden = list.length > 0;
    noticesTitle.textContent = list.length ? `Событий: ${list.length}` : '';
    let day = '';
    for (const n of list) {
      const d = dayLabel(n.ts);
      if (d !== day) {
        day = d;
        const h = el('div', 'np-day', d);
        h.setAttribute('role', 'heading');
        h.setAttribute('aria-level', '3');
        noticesScroll.append(h);
      }
      const unread = !n.read || fresh.has(n.id);
      const card = el('div', `np-card ns-${n.level}${unread ? ' np-unread' : ''}`);
      card.dataset.id = n.id;
      card.setAttribute('role', 'article');
      const { content, time } = noticeContent(n, () => markNoticeRead(n.id));
      paintNoticeTime(time, n.ts);
      card.append(content);
      if (unread) {
        const dot = el('span', 'np-dot');
        dot.title = 'Не прочитано';
        card.append(dot);
      }
      if (n.onClick) {
        card.tabIndex = 0;
        card.classList.add('np-clickable');
        const run = n.onClick;
        card.addEventListener('click', () => { markNoticeRead(n.id); run(); });
        card.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); markNoticeRead(n.id); run(); } });
      }
      noticesScroll.append(card);
    }
    if (!noticesOverlay && noticesScroll.isConnected) noticesOverlay = attachOverlayScroll(noticesScroll, { axis: 'y', host: noticesFrame });
    noticesOverlay?.sync();
  };

  /** Открыть текущую вкладку: панели, линия «Новые», прочтение. */
  const openTab = () => {
    for (const t of TABS) panels[t.value].hidden = t.value !== tab;
    renderCompose();
    if (!shown) return;
    if (tab === 'notices') {
      fresh.clear();
      for (const n of systemNotices()) if (!n.read) fresh.add(n.id);
      renderNotices();
    } else if (tab === 'comments') {
      freshCards.clear();
      for (const k of unreadCards()) freshCards.add(k);
      comments.setUnread(freshCards);
      comments.render();
      if (pendingCard) {
        const key = pendingCard;
        pendingCard = null;
        comments.reveal(key);
      }
    } else {
      const feed = feeds[tab];
      feed.render(firstUnread(tab === 'all' ? allItems() : chatItems()));
      if (pendingReveal) {
        const id = pendingReveal;
        pendingReveal = null;
        feed.reveal(id);
      }
    }
    markShown();
  };

  const v: View = {
    pill,
    openTab,
    reveal: id => (tab === 'all' || tab === 'chat' ? feeds[tab].reveal(id) : false),
    revealCard: key => comments.reveal(key),
  };
  view = v;

  unsubs.push(onNotices(ev => {
    if (ev.type === 'dnd') { renderDnd(); return; }
    renderCounts();
    if (!shown) return;
    const system = ev.type === 'push' ? ev.notice.kind === 'system' : true;
    const note = ev.type === 'push' ? ev.notice.kind === 'comment' : true;
    if (tab === 'notices') {
      if (ev.type === 'push' && system && !ev.notice.read) fresh.add(ev.notice.id);
      if (system) renderNotices();
    } else if (tab === 'comments') {
      if (ev.type === 'push' && note && ev.notice.ref && !ev.notice.read) freshCards.add(cardKeyOf(ev.notice.ref));
      comments.setUnread(new Set(freshCards));
    } else if (tab === 'all' && (system || note) && ev.type !== 'read') { feeds.all.refresh(); renderCompose(); }
    if (ev.type === 'push') markShown();
  }));
  unsubs.push(onChat(ev => {
    if (ev.type === 'state') { renderEmpties(); renderCompose(); }
    if (!shown || (tab !== 'all' && tab !== 'chat')) return;
    if (ev.type === 'message') feeds[tab].refresh();
    else feeds[tab].render(null);
  }));

  renderDnd();
  renderCounts();
  renderEmpties();
  openTab();

  return {
    actions,
    show() {
      shown = true;
      pill.setValue(tab, { instant: true });
      openTab();
    },
    hide() {
      shown = false;
      markShown();
    },
    focus() {
      if ((tab === 'all' || tab === 'chat') && composer.el.isConnected && !composeSlot.hidden) composer.focus();
      else pill.tab(tab)?.focus();
    },
  };
}

