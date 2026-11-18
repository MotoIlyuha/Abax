import type { PageRight, ProjectPermissions } from './types';

// Модель доступа Ночи №6 (SPEC_NIGHT6 §2): роли, итоговое право на странице, возможности участника,
// форма токена и именного адреса. Чистые функции без DOM — общие для клиента, обоих хабов и сервера.
// Копия правил для electron/room.cjs — в нём же (паритет — tests/server/room-pointer.test.ts).

/** Выдаваемая роль. Владелец — отдельный статус, «нет доступа» — отсутствие разрешения. */
export type AccessRole = 'editor' | 'commenter' | 'reader';
/** Роль в базе и в протоколе: новые значения и старые синонимы Ночей №3–5. */
export type StoredRole = AccessRole | 'edit' | 'view';

export const ACCESS_ROLES: readonly AccessRole[] = ['editor', 'commenter', 'reader'];
export const STORED_ROLES: readonly StoredRole[] = ['editor', 'commenter', 'reader', 'edit', 'view'];

export function isAccessRole(v: unknown): v is AccessRole {
  return v === 'editor' || v === 'commenter' || v === 'reader';
}
export function isStoredRole(v: unknown): v is StoredRole {
  return isAccessRole(v) || v === 'edit' || v === 'view';
}

/**
 * Роль из хранимого значения: 'edit' → редактор, 'view' → комментатор (старые ссылки: «смотрят» уже умели
 * комментировать, отвечать в заданиях, писать в чат и пользоваться указкой), новые — как есть. null — не роль.
 */
export function normalizeRole(raw: unknown): { role: AccessRole; legacy: boolean } | null {
  if (raw === 'edit') return { role: 'editor', legacy: true };
  if (raw === 'view') return { role: 'commenter', legacy: true };
  if (isAccessRole(raw)) return { role: raw, legacy: false };
  return null;
}

/** Старый синоним роли — для клиентов Ночей №3–5 (они понимают только edit и view). */
export function legacyRoleOf(role: AccessRole): 'edit' | 'view' {
  return role === 'editor' ? 'edit' : 'view';
}

/** Название роли в интерфейсе. */
export function roleLabel(role: AccessRole, legacy = false): string {
  const base = role === 'editor' ? 'Редактор' : role === 'commenter' ? 'Комментатор' : 'Читатель';
  return legacy && role === 'commenter' ? `${base} (старая ссылка)` : base;
}

export interface PageAccessInput {
  owner: boolean;
  role: AccessRole;
  legacy: boolean;
  /** Право страницы из project.permissions.pageRights. */
  pageSetting?: PageRight;
  /** Личное право участника на страницу (таблица участников P2P; старые записи invites.page_rights_json). */
  personal?: PageRight;
}

/**
 * Итоговое право участника на странице (SPEC_NIGHT6 §2.2), первое сработавшее правило:
 * владелец → edit; личное право; скрытая страница; старая ссылка — право страницы или её роль (как в Ночах №3–5:
 * edit страницы повышает «смотрят»); «только просмотр» → view; иначе — по роли (edit страницы новую роль не повышает).
 */
export function effectivePageAccess(a: PageAccessInput): PageRight {
  if (a.owner) return 'edit';
  if (a.personal) return a.personal;
  if (a.pageSetting === 'hidden') return 'hidden';
  if (a.legacy) return a.pageSetting ?? (a.role === 'editor' ? 'edit' : 'view');
  if (a.pageSetting === 'view') return 'view';
  return a.role === 'editor' ? 'edit' : 'view';
}

/** Что участнику можно, кроме правки страниц. Решает хаб или сервер; клиент лишь не показывает лишнего. */
export interface ParticipantCaps {
  /** Комментарии, реакции, ответ в задании. */
  comment: boolean;
  /** Писать в чат (читать могут все). */
  chat: boolean;
  /** Лазер, исчезающий маркер, подсветка. */
  pointer: boolean;
  /** Выделить и скопировать, экспорт. */
  copy: boolean;
  /** «Позвать всех сюда». */
  summon: boolean;
}

export const OWNER_CAPS: ParticipantCaps = { comment: true, chat: true, pointer: true, copy: true, summon: true };

/** Копирование для читателей и комментаторов: доска разрешает и (старая ссылка) ссылка не запрещает. */
export function copyAllowedBy(perms: ProjectPermissions | null | undefined, inviteAllowCopy?: boolean): boolean {
  return perms?.allowCopy !== false && perms?.forbidClone !== true && inviteAllowCopy !== false;
}

/** Возможности участника (SPEC_NIGHT6 §2.3). perms — уже с поправкой на тариф владельца. */
export function participantCaps(
  a: { owner: boolean; role: AccessRole; inviteAllowCopy?: boolean },
  perms: ProjectPermissions | null | undefined,
): ParticipantCaps {
  if (a.owner) return { ...OWNER_CAPS };
  const talk = a.role !== 'reader';
  return {
    comment: talk,
    chat: talk,
    pointer: talk,
    copy: a.role === 'editor' || copyAllowedBy(perms, a.inviteAllowCopy),
    summon: a.role === 'editor' && perms?.summon === 'editors',
  };
}

// ----- Токены и именные адреса (SPEC_NIGHT6 §2.5) -----

/** Токен приглашения: ровно 24 символа base64url (randomBytes(18), 144 бита). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
/** Именной адрес: 3–23 символа a–z, 0–9 и «-», с буквы, без «--» и «-» на конце. */
export const ALIAS_RE = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,22}$/;
export const ALIAS_MIN = 3;
export const ALIAS_MAX = 23;

/** Адреса, которые нельзя занять. */
export const RESERVED_ALIASES: ReadonlySet<string> = new Set([
  'api', 'j', 'p', 'admin', 'abax', 'login', 'logout', 'auth', 'help', 'support', 'new', 'settings',
  'static', 'assets', 'www', 'root', 'system', 'owner', 'null', 'undefined', 'test',
]);

export function isTokenShaped(s: unknown): s is string {
  return typeof s === 'string' && TOKEN_RE.test(s);
}

export function isAliasShaped(s: unknown): s is string {
  return typeof s === 'string' && ALIAS_RE.test(s) && !RESERVED_ALIASES.has(s);
}

/** Почему адрес не подходит (для подсказки в поле); null — подходит. */
export function aliasProblem(s: string): string | null {
  if (s.length < ALIAS_MIN) return `Не короче ${ALIAS_MIN} символов`;
  if (s.length > ALIAS_MAX) return `Не длиннее ${ALIAS_MAX} символов`;
  if (!/^[a-z0-9-]+$/.test(s)) return 'Только строчные латинские буквы, цифры и дефис';
  if (!/^[a-z]/.test(s)) return 'Начните с буквы';
  if (/--/.test(s) || s.endsWith('-')) return 'Дефис — только между буквами и цифрами';
  if (RESERVED_ALIASES.has(s)) return 'Этот адрес занят системой';
  return null;
}

// ----- Автор элемента (SPEC_NIGHT6 §2.6) -----

/** Автор элемента: u:<userId> (сессия облака) или c:<id> (участник P2P-хаба). */
export const PRINCIPAL_RE = /^[uc]:[A-Za-z0-9_-]{1,78}$/;

export function isPrincipal(v: unknown): v is string {
  return typeof v === 'string' && PRINCIPAL_RE.test(v);
}
