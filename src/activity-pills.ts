import { DEFAULT_CURSOR_ID } from './cursors';
import { pushNotice, type NoticeIcon, type NoticeInput, type NoticeUser } from './notify-center';
import { hideStackNotice } from './notify-stack';

// Уведомления комнаты (бывшие Activity Pills, SPEC_NIGHT5 §5) — теперь уведомления центра (src/notify-center.ts)
// в стопке под кнопкой «Чат и уведомления» (src/notify-stack.ts, SPEC_CHAT §2, §4). Здесь — обёртка совместимости
// showPill() (старые опции → NoticeInput) и события состава комнаты (diffUsers → структурные уведомления).

export type PillKind = 'info' | 'warn' | 'ok';

export interface PillAction { label: string; run: () => void }

export interface PillOptions {
  kind?: PillKind;
  text: string;
  /** Курсор участника (аватар в карточке). */
  cursorId?: string;
  /** Кнопка в карточке. */
  action?: PillAction;
  /** Щелчок по карточке (например, открыть чат). */
  onClick?: () => void;
  /** Отклик на моё действие: показывается, но сразу прочитано. */
  quiet?: boolean;
  icon?: NoticeIcon;
}

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

/** Показать уведомление по старым опциям; возвращает функцию, убирающую его из стопки раньше времени. */
export function showPill(opts: PillOptions): () => void {
  const n = pushNotice(pillToNotice(opts));
  return () => hideStackNotice(n.id);
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
