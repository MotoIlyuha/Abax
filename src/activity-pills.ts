import { DEFAULT_CURSOR_ID, cursorSvg, isCursorId } from './cursors';
import {
  doNotDisturb, markNoticeRead, noticeText, onNotices, pushNotice,
  type Notice, type NoticeIcon, type NoticeInput, type NoticeUser,
} from './notify-center';

// Всплывающие уведомления комнаты (Activity Pills, SPEC_NIGHT5 §5) — теперь только вид уведомлений центра
// (src/notify-center.ts, SPEC_CHAT §2): showPill() — обёртка совместимости, превращает старые опции в NoticeInput.
// Пилюли справа сверху под шапкой, не больше трёх, каждая исчезает сама. Имена и тексты приходят от других
// участников — только textContent; мини-курсор — разметка из каталога курсоров (только его константы).

export type PillKind = 'info' | 'warn' | 'ok';

export interface PillAction { label: string; run: () => void }

export interface PillOptions {
  kind?: PillKind;
  text: string;
  /** Мини-курсор участника слева от текста. */
  cursorId?: string;
  /** Кнопка в пилюле. */
  action?: PillAction;
  /** Клик по всей пилюле (например, открыть чат). */
  onClick?: () => void;
  /** Отклик на моё действие: показывается, но сразу прочитано. */
  quiet?: boolean;
  icon?: NoticeIcon;
}

/** Не больше стольких пилюль одновременно: новая вытесняет самую старую. */
export const PILL_MAX = 3;
/** Через сколько пилюля скрывается сама. */
export const PILL_MS = 3500;
/** Длительность исчезновения (CSS); без анимации — сразу. */
const LEAVE_MS = 200;

/** Старые опции пилюли → уведомление центра (kind → level, text → title, cursorId → user). */
export function pillToNotice(opts: PillOptions): NoticeInput {
  return {
    level: opts.kind ?? 'info',
    title: opts.text,
    ...(opts.icon ? { icon: opts.icon } : {}),
    ...(opts.cursorId !== undefined ? { user: { name: '', cursorId: opts.cursorId } } : {}),
    ...(opts.action ? { action: opts.action } : {}),
    ...(opts.onClick ? { onClick: opts.onClick } : {}),
    ...(opts.quiet ? { quiet: true } : {}),
  };
}

interface Live { id: string; el: HTMLElement; timer: number }
const live: Live[] = [];

function container(): HTMLElement {
  let root = document.getElementById('activity-pills');
  if (!root) {
    root = document.createElement('div');
    root.id = 'activity-pills';
    document.body.appendChild(root);
  }
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('role', 'status');
  return root;
}

function animationsOff(): boolean {
  if (document.body.classList.contains('no-motion') || document.body.classList.contains('no-ui-anim')) return true;
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
}

function dismiss(item: Live): void {
  const i = live.indexOf(item);
  if (i < 0) return;
  live.splice(i, 1);
  window.clearTimeout(item.timer);
  if (animationsOff()) { item.el.remove(); return; }
  item.el.classList.add('leaving');
  window.setTimeout(() => item.el.remove(), LEAVE_MS);
}

/** Пилюля для нового уведомления центра. */
function render(n: Notice): void {
  // «не беспокоить»: показываются только отклики на мои действия
  if (doNotDisturb() && !n.quiet) return;
  const root = container();
  while (live.length >= PILL_MAX) dismiss(live[0]);
  const el = document.createElement('div');
  el.className = `activity-pill ${n.level}`;
  if (n.user) {
    const icon = document.createElement('i');
    icon.className = 'ap-cursor';
    const id = n.user.cursorId && isCursorId(n.user.cursorId) ? n.user.cursorId : DEFAULT_CURSOR_ID;
    icon.innerHTML = cursorSvg(id, { size: 14 }); // разметка каталога курсоров — только константы
    el.appendChild(icon);
  }
  const text = document.createElement('span');
  text.className = 'ap-text';
  text.textContent = noticeText(n);
  el.appendChild(text);
  const item: Live = { id: n.id, el, timer: 0 };
  if (n.action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ap-action';
    btn.textContent = n.action.label;
    const run = n.action.run;
    btn.addEventListener('click', ev => { ev.stopPropagation(); markNoticeRead(n.id); dismiss(item); run(); });
    el.appendChild(btn);
  }
  if (n.onClick) {
    const onClick = n.onClick;
    const go = () => { markNoticeRead(n.id); dismiss(item); onClick(); };
    el.classList.add('clickable');
    el.tabIndex = 0;
    el.addEventListener('click', go);
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
  }
  root.appendChild(el);
  item.timer = window.setTimeout(() => dismiss(item), PILL_MS);
  live.push(item);
}

onNotices(ev => {
  if (ev.type === 'push') render(ev.notice);
  else if (ev.type === 'clear') for (const item of live.filter(x => ev.ids.includes(x.id))) dismiss(item);
});

/** Показать пилюлю (обёртка совместимости: уведомление центра); возвращает функцию, скрывающую её раньше времени. */
export function showPill(opts: PillOptions): () => void {
  const n = pushNotice(pillToNotice(opts));
  return () => { const item = live.find(x => x.id === n.id); if (item) dismiss(item); };
}

/** Убрать все пилюли (конец совместной работы). */
export function clearPills(): void {
  for (const item of [...live]) {
    window.clearTimeout(item.timer);
    item.el.remove();
  }
  live.length = 0;
}

/** Сколько пилюль сейчас на экране (для тестов). */
export function pillCount(): number {
  return live.length;
}

// ----- События из смены состава участников -----

export interface PillUser {
  userId: number; name: string; cursorId?: string;
  /** Ключ аватара из снимка (смайл, «photo:<версия>», null — буквы); нет поля — участник о нём ещё не сообщал. */
  avatar?: string | null;
}

export type UserEvent =
  | { kind: 'join'; user: PillUser }
  | { kind: 'leave'; user: PillUser }
  | { kind: 'rename'; user: PillUser; from: string }
  | { kind: 'cursor'; user: PillUser }
  | { kind: 'avatar'; user: PillUser };

/** Что изменилось в составе комнаты между двумя снимками {t:'users'} (себя не считаем). */
export function diffUsers(prev: readonly PillUser[], next: readonly PillUser[], myId: number): UserEvent[] {
  const before = new Map(prev.map(u => [u.userId, u]));
  const after = new Map(next.map(u => [u.userId, u]));
  const out: UserEvent[] = [];
  for (const u of next) {
    if (u.userId === myId) continue;
    const was = before.get(u.userId);
    if (!was) { out.push({ kind: 'join', user: u }); continue; }
    if (was.name !== u.name) out.push({ kind: 'rename', user: u, from: was.name });
    else if ((was.cursorId ?? DEFAULT_CURSOR_ID) !== (u.cursorId ?? DEFAULT_CURSOR_ID)) out.push({ kind: 'cursor', user: u });
    // первое сообщение об аватаре (сразу после входа) — не смена
    else if (was.avatar !== undefined && u.avatar !== undefined && was.avatar !== u.avatar) out.push({ kind: 'avatar', user: u });
  }
  for (const u of prev) if (u.userId !== myId && !after.has(u.userId)) out.push({ kind: 'leave', user: u });
  return out;
}

/** Текст события состава одной строкой. */
export function userEventText(ev: UserEvent): string {
  const name = ev.user.name || 'Участник';
  switch (ev.kind) {
    case 'join': return `${name} присоединился к доске`;
    case 'leave': return `${name} покинул доску`;
    case 'rename': return `${ev.from || 'Участник'} теперь ${name}`;
    case 'cursor': return `${name} сменил курсор`;
    case 'avatar': return `${name} сменил аватар`;
  }
}

/**
 * Событие состава — структурное уведомление: заголовок — имя, текст — что случилось, значок события,
 * участник для аватара (avatarOf — его смайл или фото, collab.ts). Смена имени: заголовок — прежнее имя.
 */
export function userEventNotice(ev: UserEvent, avatarOf?: (u: PillUser) => string | null): NoticeInput {
  const name = ev.user.name || 'Участник';
  const user: NoticeUser = { userId: ev.user.userId, name, cursorId: ev.user.cursorId ?? DEFAULT_CURSOR_ID, avatar: avatarOf ? avatarOf(ev.user) : null };
  switch (ev.kind) {
    case 'join': return { title: name, body: 'присоединился к доске', icon: 'join', level: 'ok', user };
    case 'leave': return { title: name, body: 'покинул доску', icon: 'leave', user };
    case 'rename': return { title: ev.from || 'Участник', body: `теперь ${name}`, icon: 'rename', user };
    case 'cursor': return { title: name, body: 'сменил курсор', icon: 'cursor', user };
    case 'avatar': return { title: name, body: 'сменил аватар', icon: 'avatar', user };
  }
}

/** Уведомления для событий состава. */
export function showUserEvents(events: readonly UserEvent[], avatarOf?: (u: PillUser) => string | null): void {
  for (const ev of events) pushNotice(userEventNotice(ev, avatarOf));
}
