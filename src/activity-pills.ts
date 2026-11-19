import { DEFAULT_CURSOR_ID, cursorSvg, isCursorId } from './cursors';

// Всплывающие уведомления комнаты (Activity Pills, SPEC_NIGHT5 §5): справа сверху под шапкой, не больше трёх,
// каждое исчезает само. Имена и тексты приходят от других участников — только textContent; мини-курсор —
// разметка из каталога курсоров (только его константы, как у курсоров участников в collab.ts).

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
}

/** Не больше стольких пилюль одновременно: новая вытесняет самую старую. */
export const PILL_MAX = 3;
/** Через сколько пилюля скрывается сама. */
export const PILL_MS = 3500;
/** Длительность исчезновения (CSS); без анимации — сразу. */
const LEAVE_MS = 200;

interface Live { el: HTMLElement; timer: number }
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

/** Показать пилюлю; возвращает функцию, скрывающую её раньше времени. */
export function showPill(opts: PillOptions): () => void {
  const root = container();
  while (live.length >= PILL_MAX) dismiss(live[0]);
  const el = document.createElement('div');
  el.className = `activity-pill ${opts.kind ?? 'info'}`;
  if (opts.cursorId !== undefined) {
    const icon = document.createElement('i');
    icon.className = 'ap-cursor';
    const id = isCursorId(opts.cursorId) ? opts.cursorId : DEFAULT_CURSOR_ID;
    icon.innerHTML = cursorSvg(id, { size: 14 });
    el.appendChild(icon);
  }
  const text = document.createElement('span');
  text.className = 'ap-text';
  text.textContent = opts.text;
  el.appendChild(text);
  const item: Live = { el, timer: 0 };
  if (opts.action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ap-action';
    btn.textContent = opts.action.label;
    const run = opts.action.run;
    btn.addEventListener('click', ev => { ev.stopPropagation(); dismiss(item); run(); });
    el.appendChild(btn);
  }
  if (opts.onClick) {
    const onClick = opts.onClick;
    el.classList.add('clickable');
    el.tabIndex = 0;
    el.addEventListener('click', () => { dismiss(item); onClick(); });
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); dismiss(item); onClick(); } });
  }
  root.appendChild(el);
  item.timer = window.setTimeout(() => dismiss(item), PILL_MS);
  live.push(item);
  return () => dismiss(item);
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

/** Текст пилюли для события состава. */
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

/** Показать пилюли для событий состава. */
export function showUserEvents(events: readonly UserEvent[]): void {
  for (const ev of events) showPill({ kind: 'info', text: userEventText(ev), cursorId: ev.user.cursorId ?? DEFAULT_CURSOR_ID });
}
