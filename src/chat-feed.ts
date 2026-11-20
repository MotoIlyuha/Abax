// Лента режима «Чат и уведомления» (SPEC_CHAT §6): вкладка «Все» — сообщения чата и системные события по времени,
// вкладка «Чат» — только сообщения.
//  • Сообщения группируются: подряд от одного автора в пределах GROUP_GAP_MS (промежуток 2 px, между группами 12 px).
//    Чужие — слева: аватар 28 px у первого сообщения группы, над группой имя (цвет плашки курсора) и время; пузырь
//    --surface-sunken, радиус 16, угол к аватару 6. Свои — справа, акцентный пузырь с белым текстом, без аватара.
//    Сообщение только из 1–3 эмодзи — крупно, без пузыря. Полное время — в подсказке (title).
//  • Разделители дней («Сегодня», «Вчера», «18 ноября»), линия «Новые» над первым непрочитанным на момент открытия.
//  • Системное событие — компактная строка по центру: мини-аватар или значок 20 px, текст, время; warn — янтарный.
//  • Новое сообщение появляется: «Улучшенные» — пружина (подъём 8 px и масштаб .96→1), «Обычные» — CSS 180 мс,
//    «Выкл» — сразу. Пользователь внизу — лента прокручивается сама, иначе — кнопка «↓ Новые сообщения».
// Всё, что написали участники, — только textContent; ссылки — <a target="_blank" rel="noopener noreferrer">
// только для https:// (src/room-chat.ts, tokenizeChat). SVG — константы каталога иконок.

import { S, clamp, register, step, tune, wake, type Spring } from './motion';
import { menuMotion } from './menu-motion';
import { createUserAvatar } from './avatar';
import { DEFAULT_CURSOR_ID, cursorPreset, isCursorId } from './cursors';
import { attachOverlayScroll, type OverlayScroll } from './overlay-scroll';
import { tokenizeChat, type ChatMessage } from './room-chat';
import { noticeActions, noticeText, type Notice } from './notify-center';
import { noticeIconSvg } from './notice-card';
import { renderAttachment } from './chat-attach-view';
import { chatAvatarOf } from './collab-chat';

/** Сообщения одного автора дальше друг от друга, чем на столько, — разные группы. */
export const GROUP_GAP_MS = 3 * 60_000;
/** Сколько пикселей от низа ещё считается «внизу». */
const BOTTOM_SLACK = 32;
const FLASH_MS = 1600;
const ENTER: readonly [number, number] = [260, 24];

export type FeedItem =
  | { kind: 'msg'; id: string; ts: number; m: ChatMessage }
  | { kind: 'event'; id: string; ts: number; n: Notice };

// ----- Чистые правила (для тестов) -----

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const pad2 = (v: number): string => String(v).padStart(2, '0');

export function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Разделитель дня: «Сегодня», «Вчера», «18 ноября» (другой год — «18 ноября 2025»). */
export function dayLabel(ts: number, now = Date.now()): string {
  if (sameDay(ts, now)) return 'Сегодня';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(ts, y.getTime())) return 'Вчера';
  const d = new Date(ts);
  const base = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Время «14:02». */
export function timeHM(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Полное время для подсказки: «19 ноября 2026, 14:02». */
export function fullTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}, ${timeHM(ts)}`;
}

/** Одно эмодзи: флаг, или пиктограмма с модификаторами и склейками ZWJ. */
const EMOJI = /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}️\u{E0020}-\u{E007F}]*(?:‍\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}️]*)*/gu;

/** Сколько эмодзи в сообщении, если в нём нет ничего, кроме эмодзи и пробелов; иначе 0. */
export function emojiCount(text: string): number {
  const s = text.replace(/\s+/g, '');
  if (!s) return 0;
  const found = s.match(EMOJI);
  if (!found || found.join('') !== s) return 0;
  return found.length;
}

/** Сообщение показывается крупными эмодзи без пузыря: 1–3 эмодзи. */
export function isEmojiOnly(text: string): boolean {
  const n = emojiCount(text);
  return n >= 1 && n <= 3;
}

/** Сообщение cur продолжает группу prev: тот же автор, тот же день, не дальше GROUP_GAP_MS. */
export function continuesGroup(prev: FeedItem | undefined, cur: FeedItem): boolean {
  return !!prev && prev.kind === 'msg' && cur.kind === 'msg' && prev.m.by === cur.m.by
    && cur.ts - prev.ts <= GROUP_GAP_MS && cur.ts >= prev.ts && sameDay(prev.ts, cur.ts);
}

/** Цвет имени — плашка курсора; слишком светлая (янтарь) на белом не читается — тогда цвет выделения. */
export function nameColor(cursorId: string | undefined): string {
  const p = cursorPreset(cursorId && isCursorId(cursorId) ? cursorId : DEFAULT_CURSOR_ID);
  const m = /^#([0-9a-f]{6})$/i.exec(p.badgeBg);
  if (!m) return p.badgeBg;
  const v = parseInt(m[1], 16);
  const lum = (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
  return lum > 0.62 ? p.selectionColor : p.badgeBg;
}

// ----- Появление («Улучшенные») -----

interface Enter { el: HTMLElement; p: Spring }
const entering = new Set<Enter>();
let looped = false;

function paintEnter(e: Enter): void {
  const p = e.p.x;
  e.el.style.transform = `translateY(${((1 - p) * 8).toFixed(2)}px) scale(${(0.96 + 0.04 * p).toFixed(4)})`;
  e.el.style.opacity = clamp(p * 1.4, 0, 1).toFixed(3);
}

function ensureLoop(): void {
  if (looped) return;
  looped = true;
  register({
    frame(dt) { for (const e of entering) step(e.p, dt); },
    render() {
      for (const e of [...entering]) {
        const done = !e.el.isConnected || (Math.abs(e.p.x - 1) < 0.002 && Math.abs(e.p.v) < 0.02);
        if (done) {
          entering.delete(e);
          e.el.style.removeProperty('transform');
          e.el.style.removeProperty('opacity');
        } else paintEnter(e);
      }
    },
    settled: () => entering.size === 0,
  });
}

/** Новый узел ленты появляется по режиму анимаций. */
function animateIn(el: HTMLElement): void {
  const mode = menuMotion();
  if (mode === 'off') return;
  if (mode === 'normal') {
    el.classList.add('cf-in');
    el.addEventListener('animationend', () => el.classList.remove('cf-in'), { once: true });
    return;
  }
  const p = S(0);
  tune(p, ...ENTER);
  p.t = 1;
  const e = { el, p };
  paintEnter(e);
  entering.add(e);
  ensureLoop();
  wake();
}

// ----- Разметка -----

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Текст сообщения: строки текстом, ссылки https — <a> с textContent. */
export function fillChatText(box: HTMLElement, text: string): void {
  for (const tok of tokenizeChat(text)) {
    if (tok.kind === 'link') {
      const a = document.createElement('a');
      a.href = tok.value;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = tok.value;
      box.appendChild(a);
    } else {
      box.appendChild(document.createTextNode(tok.value));
    }
  }
}

function avatarFor(user: { userId?: number; name: string; cursorId?: string; avatar?: string | null }, cls: string): HTMLElement {
  const id = user.cursorId && isCursorId(user.cursorId) ? user.cursorId : DEFAULT_CURSOR_ID;
  const p = cursorPreset(id);
  const av = createUserAvatar({ name: user.name || 'Участник', bg: p.badgeBg, fg: p.badgeText, cursorId: id, avatar: user.avatar ?? null, status: 'online' }, cls);
  av.tabIndex = -1;
  av.removeAttribute('title');
  av.removeAttribute('aria-label');
  av.setAttribute('aria-hidden', 'true');
  return av;
}

function messageNode(m: ChatMessage): HTMLElement {
  const row = el('div', 'cf-msg');
  row.dataset.id = m.id;
  row.title = fullTime(m.ts);
  const att = renderAttachment(m);
  if (att) row.append(att);
  if (m.text) {
    if (isEmojiOnly(m.text)) {
      row.classList.add('cf-emoji-msg');
      row.append(el('div', 'cf-emoji', m.text.replace(/\s+/g, ' ').trim()));
    } else {
      const bubble = el('div', 'cf-bubble');
      fillChatText(bubble, m.text);
      row.append(bubble);
    }
  }
  return row;
}

function eventNode(n: Notice): HTMLElement {
  const row = el('div', `cf-event cf-${n.level}`);
  row.dataset.id = n.id;
  row.title = fullTime(n.ts);
  const media = el('span', 'cf-ev-media');
  media.setAttribute('aria-hidden', 'true');
  if (n.user) media.append(avatarFor(n.user, 'cf-ev-avatar'));
  else if (n.emoji) {
    media.classList.add('cf-ev-icon', 'cf-ev-emoji');
    media.textContent = n.emoji;
  } else {
    media.classList.add('cf-ev-icon');
    media.innerHTML = noticeIconSvg(n); // константа каталога иконок
  }
  // текст, время и действие — одной строкой текста: длинное событие переносится целиком
  const body = el('span', 'cf-ev-body');
  const time = el('time', 'cf-ev-time', timeHM(n.ts));
  time.dateTime = new Date(n.ts).toISOString();
  body.append(el('span', 'cf-ev-text', noticeText(n)), time);
  for (const a of noticeActions(n)) {
    const act = el('button', 'cf-ev-action', a.label);
    act.type = 'button';
    act.addEventListener('click', () => a.run());
    body.append(act);
  }
  row.append(media, body);
  return row;
}

// ----- Лента -----

export interface ChatFeedOptions {
  /** Что показывать: элементы ленты по времени. */
  items: () => FeedItem[];
  /** Мой идентификатор в комнате. */
  me: () => number;
  /** Подпись ленты для чтения с экрана. */
  label: string;
}

export interface ChatFeed {
  readonly el: HTMLElement;
  /** Перерисовать целиком; newFrom — id первого непрочитанного (над ним линия «Новые»). */
  render(newFrom?: string | null): void;
  /** Данные изменились: новое в конце дорисовывается с анимацией, остальное — перерисовка. */
  refresh(): void;
  /** Прокрутить к сообщению и мягко подсветить; false — его нет в ленте. */
  reveal(id: string): boolean;
  /** Пустое состояние (узел или null — без него). */
  setEmpty(node: HTMLElement | null): void;
  scrollToBottom(smooth?: boolean): void;
  /** Видна ли кнопка «↓ Новые сообщения». */
  readonly jumpShown: boolean;
}

interface Group { el: HTMLElement; msgs: HTMLElement; mine: boolean }

export function createChatFeed(o: ChatFeedOptions): ChatFeed {
  const root = el('div', 'cf');
  const scroller = el('div', 'cf-scroll');
  scroller.setAttribute('role', 'log');
  scroller.setAttribute('aria-label', o.label);
  scroller.tabIndex = 0;
  const list = el('div', 'cf-list');
  scroller.append(list);
  const empty = el('div', 'cf-empty');
  empty.hidden = true;
  const jump = el('button', 'cf-jump', '↓ Новые сообщения');
  jump.type = 'button';
  jump.hidden = true;
  jump.addEventListener('click', () => scrollToBottom(true));
  root.append(scroller, empty, jump);
  let scroll: OverlayScroll | null = null;
  const ensureScroll = () => {
    if (!scroll && root.isConnected) scroll = attachOverlayScroll(scroller, { axis: 'y', host: root });
  };

  let shown: FeedItem[] = [];
  let me = -1;
  let last: FeedItem | undefined;
  let group: Group | null = null;
  let newFrom: string | null = null;
  let emptyNode: HTMLElement | null = null;

  const atBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < BOTTOM_SLACK;
  const smoothOk = () => menuMotion() !== 'off';

  function scrollToBottom(smooth = false): void {
    const top = scroller.scrollHeight;
    if (smooth && smoothOk() && typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: 'smooth' });
    else scroller.scrollTop = top;
    jump.hidden = true;
    stick = true;
  }

  /** Пользователь внизу ленты: при смене высоты (поле ввода выросло, панель ниже) лента остаётся прижатой к низу. */
  let stick = true;
  scroller.addEventListener('scroll', () => {
    stick = atBottom();
    if (!jump.hidden && stick) jump.hidden = true;
  });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (stick) scroller.scrollTop = scroller.scrollHeight; }) : null;
  ro?.observe(scroller);

  /** Дописать элемент в конец ленты; возвращает узел, который появляется. */
  function append(item: FeedItem): HTMLElement {
    let fresh: HTMLElement | null = null;
    let breakGroup = false;
    if (!last || !sameDay(last.ts, item.ts)) {
      const day = el('div', 'cf-day');
      day.setAttribute('role', 'separator');
      day.append(el('span', 'cf-day-label', dayLabel(item.ts)));
      list.append(day);
      breakGroup = true;
    }
    if (newFrom && item.id === newFrom) {
      const line = el('div', 'cf-new');
      line.setAttribute('role', 'separator');
      line.append(el('span', 'cf-new-label', 'Новые'));
      list.append(line);
      breakGroup = true;
    }
    if (item.kind === 'event') {
      fresh = eventNode(item.n);
      list.append(fresh);
      group = null;
    } else {
      const m = item.m;
      const node = messageNode(m);
      if (!breakGroup && group && continuesGroup(last, item)) {
        group.msgs.append(node);
        fresh = node;
      } else {
        const mine = m.by === me;
        const g = el('div', `cf-group${mine ? ' cf-mine' : ''}`);
        g.dataset.by = String(m.by);
        const col = el('div', 'cf-col');
        const meta = el('div', 'cf-meta');
        if (!mine) {
          g.append(avatarFor({ userId: m.by, name: m.name, cursorId: m.cursorId, avatar: chatAvatarOf(m.by) }, 'cf-avatar'));
          const name = el('span', 'cf-name', m.name || 'Участник');
          name.style.color = nameColor(m.cursorId);
          meta.append(name);
        }
        const time = el('time', 'cf-time', timeHM(m.ts));
        time.dateTime = new Date(m.ts).toISOString();
        meta.append(time);
        const msgs = el('div', 'cf-msgs');
        msgs.append(node);
        col.append(meta, msgs);
        g.append(col);
        list.append(g);
        group = { el: g, msgs, mine };
        fresh = g;
      }
    }
    last = item;
    return fresh;
  }

  function syncEmpty(): void {
    const none = shown.length === 0;
    empty.hidden = !none || !emptyNode;
    scroller.hidden = none && !!emptyNode;
    if (none) jump.hidden = true;
  }

  function rebuild(): void {
    me = o.me();
    list.textContent = '';
    last = undefined;
    group = null;
    shown = o.items().slice();
    for (const it of shown) append(it);
    syncEmpty();
    ensureScroll();
    scroll?.sync();
  }

  return {
    el: root,
    get jumpShown() { return !jump.hidden; },
    render(from = null) {
      newFrom = from;
      rebuild();
      const line = list.querySelector<HTMLElement>('.cf-new');
      if (line && scroller.scrollHeight > scroller.clientHeight) {
        // новые видны сразу под линией — кнопка «↓ Новые сообщения» не нужна
        scroller.scrollTop = Math.max(0, line.offsetTop - 8);
        jump.hidden = true;
      } else scrollToBottom();
    },
    refresh() {
      const items = o.items();
      const appendable = o.me() === me && items.length >= shown.length && shown.every((s, i) => items[i]?.id === s.id && items[i]?.kind === s.kind);
      if (!appendable) {
        const bottom = atBottom();
        const top = scroller.scrollTop;
        rebuild();
        if (bottom) scrollToBottom();
        else scroller.scrollTop = top;
        return;
      }
      const added = items.slice(shown.length);
      if (!added.length) return;
      const bottom = atBottom();
      let mineAdded = false;
      for (const it of added) {
        shown.push(it);
        animateIn(append(it));
        if (it.kind === 'msg' && it.m.by === me) mineAdded = true;
      }
      syncEmpty();
      ensureScroll();
      if (bottom || mineAdded) scrollToBottom();
      else if (added.some(it => it.kind === 'msg')) jump.hidden = false;
      scroll?.sync();
    },
    reveal(id) {
      const node = [...list.querySelectorAll<HTMLElement>('.cf-msg')].find(n => n.dataset.id === id);
      if (!node) return false;
      const r = node.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      const top = Math.max(0, scroller.scrollTop + r.top - s.top - (scroller.clientHeight - r.height) / 2);
      if (smoothOk() && typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: 'smooth' });
      else scroller.scrollTop = top;
      node.classList.remove('cf-flash');
      void node.offsetWidth;
      node.classList.add('cf-flash');
      window.setTimeout(() => node.classList.remove('cf-flash'), FLASH_MS);
      return true;
    },
    setEmpty(node) {
      emptyNode = node;
      empty.textContent = '';
      if (node) empty.append(node);
      syncEmpty();
    },
    scrollToBottom,
  };
}

