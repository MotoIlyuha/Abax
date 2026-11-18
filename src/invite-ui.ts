import { buildBoardUrl } from './board-url';
import { ApiError, cloudEnabled, getApi } from './api-client';
import { cloudStorage } from './cloud-sync';
import { collabActive, isHost, sendProjectNow } from './collab';
import { linkBaseUrl } from './link-view';
import { doskaApi } from './storage';
import { isNativeApp } from './native';
import { onDraft, state, update } from './state';
import { getSyncedRev } from './sync-state';
import { MAX_GUESTS_LIMIT, PLAN_LIMITS } from './limits';
import { limitsEnforced, userPlan } from './plan';
import { normalizeRole, roleLabel, type AccessRole, type StoredRole } from './access';
import type { PageRight, ProjectPermissions } from './types';

// Общая ссылка доски и приглашения по почте: запросы к серверу и тексты (без вёрстки окна — она в share-dialog.ts).
// Всё, что пришло от сервера или ввёл пользователь, выводится только через textContent (это делает окно).

/** Общая ссылка доски так, как её видит владелец (SPEC_NIGHT6 §5.2). */
export interface LinkInfo {
  token: string;
  url: string;
  /** Чистая ссылка /j/… (сервер раздаёт клиента); null — формат с параметрами. */
  prettyUrl: string | null;
  /** Старый синоним роли (для прежних клиентов). */
  defaultRole: 'edit' | 'view';
  /** Роль, как хранится (в т.ч. старые edit/view). */
  role: StoredRole;
  allowCopy: boolean;
  pageRights: Record<string, PageRight>;
  /** Ссылка не на паузе. */
  enabled: boolean;
  /** Именной адрес доски; null — нет. */
  alias: string | null;
}

export interface EmailInvite {
  id: string;
  projectId: string;
  email: string;
  role: StoredRole;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  createdAt: number;
  updatedAt: number;
  /** Последний вход по ссылке из письма; null — ещё не заходил. */
  lastUsedAt?: number | null;
}

export const TEXT_UNSYNCED = 'Проект ещё не сохранён в облаке. Подождите немного и откройте окно снова.';
export const TEXT_OFFLINE = 'Нет связи с сервером.';

/** Статус приглашения по почте — по-русски (как его хранит сервер). */
export const EMAIL_STATUS_TEXT: Record<EmailInvite['status'], string> = {
  pending: 'ожидает',
  accepted: 'принято',
  declined: 'отклонено',
  revoked: 'отозвано',
};

/** Выдаваемые роли в списках выбора. */
export const ROLE_OPTIONS: readonly AccessRole[] = ['editor', 'commenter', 'reader'];

/** Название роли в интерфейсе (старые edit/view — с пометкой). */
export function storedRoleLabel(role: StoredRole): string {
  const r = normalizeRole(role) ?? { role: 'commenter' as const, legacy: true };
  if (r.legacy && r.role === 'editor') return 'Редактор (старая ссылка)';
  return roleLabel(r.role, r.legacy);
}

/** Дата «18 нояб.»; сегодня — «сегодня». */
export function shortDate(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return 'сегодня';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/**
 * Что известно о приглашении: отправлено и ещё не заходил, заходил(а) когда, отклонено.
 * «Принято» — лишь нажатая кнопка, а не вход, поэтому главное — был ли вход по ссылке.
 */
export function emailInviteStatusText(inv: EmailInvite, now = Date.now()): string {
  if (inv.status === 'declined') return 'отклонено';
  if (inv.status === 'revoked') return 'отозвано';
  if (inv.lastUsedAt) return `заходил(а) ${shortDate(inv.lastUsedAt, now)}`;
  return inv.status === 'accepted' ? 'принято, ещё не заходил' : 'отправлено, ещё не заходил';
}

/** Понятный текст ошибки приглашения по почте по коду ответа сервера. */
export function emailInviteErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Не удалось отправить приглашение';
  if (e.isNetwork) return TEXT_OFFLINE;
  switch (e.code) {
    case 'bad-email': return 'Проверьте адрес почты';
    case 'bad-role': return 'Выберите роль: редактор, комментатор или читатель';
    case 'self-invite': return 'Это ваш собственный адрес';
    case 'mail-disabled': return 'Отправка писем на сервере не настроена';
    case 'mail-failed': return 'Письмо не ушло. Попробуйте ещё раз чуть позже';
    default: break;
  }
  if (e.status === 404) return TEXT_UNSYNCED;
  if (e.status === 429) return 'Слишком много приглашений. Попробуйте через час';
  return 'Не удалось отправить приглашение';
}

/** Варианты лимита гостей в списке (0 — без ограничений). */
export const MAX_GUESTS_OPTIONS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, MAX_GUESTS_LIMIT];

/** Ссылка для гостя: адрес веб-клиента и токен (формат с параметрами — работает везде, где нет путей /j/…). */
export function inviteLink(token: string): string {
  return buildBoardUrl(linkBaseUrl(location, !!doskaApi || isNativeApp()), { mode: 'collab', token });
}

/** Ссылка, которую показывать и копировать: чистая /j/… (если сервер раздаёт клиента), иначе с параметрами. */
export function linkUrlOf(info: Pick<LinkInfo, 'token' | 'prettyUrl'>): string {
  return info.prettyUrl ?? inviteLink(info.token);
}

/** Тариф заблокировал возможность (лимиты включены и на тарифе её нет). */
export function planLocks(feature: 'canSetMaxGuests' | 'canProtectCopy' | 'canSetAlias'): boolean {
  return limitsEnforced() && !PLAN_LIMITS[userPlan()][feature];
}

/** Поделиться доской через облако можно: облако есть, это не черновик, не просмотр по ссылке и не чужая доска. */
export function cloudShareAvailable(): boolean {
  return cloudEnabled() && !onDraft() && !state.linkMode && state.collabRole !== 'guest';
}
/** Проект уже сохранён в облаке (без этого ссылку и приглашения не создать). */
export const cloudSynced = (): boolean => getSyncedRev(state.project.id) !== null;

/**
 * Права проекта поменялись: проект сохраняется (облако или комната автора), а подключённые гости получают
 * новые права сразу (хаб пересчитывает права по permissions).
 */
export function setProjectPermissions(next: ProjectPermissions): void {
  state.project.permissions = next;
  update(true);
  if (collabActive() && isHost()) sendProjectNow(state.project);
}

/** Право страницы в матрице: '' — как у роли. */
export function setPageRightInProject(pageId: string, right: PageRight | ''): void {
  const perms = state.project.permissions ?? {};
  const pageRights: Record<string, PageRight> = { ...(perms.pageRights ?? {}) };
  if (right === '') delete pageRights[pageId];
  else pageRights[pageId] = right;
  setProjectPermissions({ ...perms, pageRights });
}

/** Лимит гостей автора (0 — без ограничений). */
export function setMaxGuestsInProject(max: number): void {
  const perms = { ...(state.project.permissions ?? {}) };
  if (max >= 1 && max <= MAX_GUESTS_LIMIT && Number.isInteger(max)) perms.maxGuests = max;
  else delete perms.maxGuests;
  setProjectPermissions(perms);
}

/** Одно поле прав проекта (true/false или значение; undefined — убрать поле). */
export function setPermissionField<K extends keyof ProjectPermissions>(key: K, value: ProjectPermissions[K] | undefined): void {
  const perms = { ...(state.project.permissions ?? {}) };
  if (value === undefined) delete perms[key];
  else perms[key] = value;
  setProjectPermissions(perms);
}

// ----- Запросы -----

function api() {
  const a = getApi();
  if (!a) throw new ApiError(0, 'no-api', true);
  return a;
}

/** Общая ссылка доски (в т.ч. на паузе); null — ещё не создана. */
export async function fetchLink(projectId: string): Promise<LinkInfo | null> {
  const r = await api().request<{ invite: LinkInfo | null }>('GET', `/api/invites?projectId=${encodeURIComponent(projectId)}`);
  return r.invite;
}

/** Создать или изменить общую ссылку; доска сначала уходит в облако. */
export async function saveLink(projectId: string, body: { defaultRole?: StoredRole; allowCopy?: boolean; enabled?: boolean }): Promise<LinkInfo> {
  await cloudStorage()?.flush();
  if (getSyncedRev(projectId) === null) throw new ApiError(404, 'project-not-found');
  const payload: Record<string, unknown> = { projectId, ...body };
  if (planLocks('canProtectCopy')) delete payload.allowCopy;
  return api().request<LinkInfo>('POST', '/api/invites', payload);
}

/** «Сбросить ссылку»: прежняя перестаёт работать, новая — с теми же правами. */
export async function resetLink(token: string): Promise<LinkInfo> {
  return api().request<LinkInfo>('POST', `/api/invites/${encodeURIComponent(token)}/reset`);
}

export async function fetchEmailInvites(projectId: string): Promise<EmailInvite[]> {
  const r = await api().request<{ invites: EmailInvite[] }>('GET', `/api/projects/${encodeURIComponent(projectId)}/email-invites`);
  return Array.isArray(r.invites) ? r.invites : [];
}

/** Пригласить по почте (или сменить роль приглашения тому же адресу). */
export async function sendEmailInvite(projectId: string, email: string, role: StoredRole): Promise<{ invite: EmailInvite; created: boolean; mailed: boolean }> {
  await cloudStorage()?.flush();
  if (getSyncedRev(projectId) === null) throw new ApiError(404, 'project-not-found');
  return api().request('POST', `/api/projects/${encodeURIComponent(projectId)}/email-invites`, { email, role });
}

export async function revokeEmailInvite(inv: EmailInvite): Promise<void> {
  await api().request('DELETE', `/api/projects/${encodeURIComponent(inv.projectId)}/email-invites/${encodeURIComponent(inv.id)}`);
}

/** Именной адрес доски и бывшие адреса (Pro/Tutor). */
export interface AliasInfo { alias: string | null; former: string[]; prettyUrl?: string | null }

export async function fetchAlias(projectId: string): Promise<AliasInfo> {
  return api().request<AliasInfo>('GET', `/api/projects/${encodeURIComponent(projectId)}/alias`);
}
export async function saveAlias(projectId: string, alias: string): Promise<AliasInfo> {
  return api().request<AliasInfo>('PUT', `/api/projects/${encodeURIComponent(projectId)}/alias`, { alias });
}
export async function releaseAlias(projectId: string, alias: string): Promise<void> {
  await api().request('DELETE', `/api/projects/${encodeURIComponent(projectId)}/alias/${encodeURIComponent(alias)}`);
}

/** Текст ошибки именного адреса по коду сервера. */
export function aliasErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Не удалось сохранить адрес';
  if (e.isNetwork) return TEXT_OFFLINE;
  switch (e.code) {
    case 'bad-alias': return 'Адрес не подходит: 3–23 строчные латинские буквы, цифры и дефис, с буквы';
    case 'plan-limit-alias': return 'Именной адрес доступен в подписке Pro';
    case 'alias-taken': return 'Этот адрес уже занят';
    case 'alias-limit': return 'Слишком много адресов. Освободите один из бывших';
    default: return 'Не удалось сохранить адрес';
  }
}
