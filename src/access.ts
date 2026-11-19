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

/**
 * Возможности участника (SPEC_NIGHT6 §2.3). perms — уже с поправкой на тариф владельца.
 * Редактор новой роли копирует всегда; старая ссылка edit — по правам доски, как в Ночах №3–5 (без молчаливого расширения).
 */
export function participantCaps(
  a: { owner: boolean; role: AccessRole; legacy?: boolean; inviteAllowCopy?: boolean },
  perms: ProjectPermissions | null | undefined,
): ParticipantCaps {
  if (a.owner) return { ...OWNER_CAPS };
  const talk = a.role !== 'reader';
  return {
    comment: talk,
    chat: talk,
    pointer: talk,
    copy: (a.role === 'editor' && a.legacy !== true) || copyAllowedBy(perms, a.inviteAllowCopy),
    summon: a.role === 'editor' && perms?.summon === 'editors',
  };
}

// ----- Токены и именные адреса (SPEC_NIGHT6 §2.5) -----

/** Токен приглашения: ровно 24 символа base64url (randomBytes(18), 144 бита). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
/**
 * Форма именного адреса: 3–23 символа a–z, 0–9 и «-», с буквы, без «--» и «-» на конце.
 * По этой форме адрес узнаётся при входе (/j/:x): адреса 3–5 символов, занятые до введения ALIAS_MIN, продолжают работать.
 */
export const ALIAS_RE = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){2,22}$/;
/**
 * Минимальная длина нового адреса — 12: одно слово («fizika», «algebra») уже не помещается, адрес собирается
 * из предмета и уточнения («fizika-9a-2026», «algebra-uroki») и потому почти всегда свободен; короткие слова
 * разбирают первыми, а адрес — это вход на доску, и короткие проще перебрать. Решение пользователя.
 */
export const ALIAS_MIN = 12;
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

/** Адрес, который можно занять заново: форма и не короче ALIAS_MIN. */
export function isNewAliasOk(s: unknown): s is string {
  return isAliasShaped(s) && s.length >= ALIAS_MIN;
}

/** Слова-уточнения для похожих адресов (транслит: адреса — латиницей). */
const ALIAS_WORDS = ['uroki', 'doska', 'klass', 'kurs', 'shkola'] as const;

/**
 * Похожие адреса для base (занятого или слишком короткого), как подсказки Gmail: base с годом, словом-уточнением
 * или цифрами; короткий base дополняется до ALIAS_MIN. Свободны ли они — решает сервер; здесь только кандидаты
 * нужной формы, без повторов и без самого base. rnd — случайное целое в [0, n) (на сервере — криптостойкое).
 */
export function aliasCandidates(base: string, year: number, rnd: (n: number) => number): string[] {
  const out: string[] = [];
  const digits = (n: number) => String(10 ** (n - 1) + rnd(9 * 10 ** (n - 1)));
  // длинный base укорачивается так, чтобы суффикс поместился; дефис на стыке не остаётся
  const fit = (tail: string) => {
    const head = base.slice(0, ALIAS_MAX - tail.length).replace(/-+$/, '');
    return head ? head + tail : '';
  };
  // число дополняет короткий base до минимума целиком: «fizika-31847», а не «fizika-47-318»
  const num = (n: number) => fit(`-${digits(Math.min(8, Math.max(n, ALIAS_MIN - base.length - 1)))}`);
  const wordy = (w: string) => {
    const c = fit(`-${w}`);
    return c.length >= ALIAS_MIN ? c : fit(`-${w}-${year}`);
  };
  const words = [...ALIAS_WORDS];
  const word = () => words.splice(rnd(words.length), 1)[0];
  const w1 = word();
  const w2 = word();
  const w3 = word();
  for (const c of [fit(`-${year}`), wordy(w1), num(2), wordy(w2), num(3), fit(`-${w1}-${year}`), num(4), wordy(w3)]) {
    if (c && c !== base && isNewAliasOk(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Почему адрес не подходит (для подсказки в поле); null — подходит. */
export function aliasProblem(s: string): string | null {
  // сначала — что не исправить дописыванием (недопустимые символы видны с первой буквы), затем длина
  if (!/^[a-z0-9-]*$/.test(s)) return 'Только строчные латинские буквы, цифры и дефис';
  if (s && !/^[a-z]/.test(s)) return 'Начните с буквы';
  if (/--/.test(s) || s.endsWith('-')) return 'Дефис — только между буквами и цифрами';
  if (RESERVED_ALIASES.has(s)) return 'Этот адрес занят системой';
  if (s.length < ALIAS_MIN) return `Не короче ${ALIAS_MIN} символов`;
  if (s.length > ALIAS_MAX) return `Не длиннее ${ALIAS_MAX} символов`;
  return null;
}

// ----- Автор элемента (SPEC_NIGHT6 §2.6) -----

/** Автор элемента: u:<userId> (сессия облака) или c:<id> (участник P2P-хаба). */
export const PRINCIPAL_RE = /^[uc]:[A-Za-z0-9_-]{1,78}$/;

export function isPrincipal(v: unknown): v is string {
  return typeof v === 'string' && PRINCIPAL_RE.test(v);
}
