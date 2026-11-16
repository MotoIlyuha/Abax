import type { PageRight, Project } from './types';
import { ApiError, type ApiClient } from './api-client';
import type { AssetStore } from './asset-store';
import { assetStore, hydrateFromCloud } from './cloud-assets';

// Просмотр по ссылке и приглашения через облако: запросы к серверу и разбор ответов (без DOM и состояния).
// Всё, что идёт с сервера, уже отфильтровано и замаскировано им; клиент ничего не «достраивает».

export type CloudFailure = 'not-found' | 'page-not-found' | 'network' | 'error';

export type CloudResult<T> = { ok: true; value: T } | { ok: false; reason: CloudFailure; code?: string };

function failure(e: unknown): { ok: false; reason: CloudFailure; code?: string } {
  if (!(e instanceof ApiError)) return { ok: false, reason: 'error' };
  if (e.isNetwork) return { ok: false, reason: 'network' };
  if (e.status === 404) return { ok: false, reason: e.code === 'page-not-found' ? 'page-not-found' : 'not-found', code: e.code };
  return { ok: false, reason: 'error', code: e.code };
}

export interface CloudProjectView {
  project: Project;
  role: 'host' | 'viewer' | 'guest';
  rev: number;
  canClone: boolean;
  allowCopy: boolean;
}

/** Проект по ссылке просмотра: с сервера, с картинками на месте. pageId — для ссылки на одну страницу. */
export async function loadCloudView(
  api: ApiClient, projectId: string, pageId?: string, store: AssetStore = assetStore,
): Promise<CloudResult<CloudProjectView>> {
  try {
    const q = pageId ? `?pageId=${encodeURIComponent(pageId)}` : '';
    const r = await api.request<CloudProjectView>('GET', `/api/projects/${encodeURIComponent(projectId)}${q}`, undefined, { anonymous: true });
    return { ok: true, value: { ...r, project: await hydrateFromCloud(r.project, api, store) } };
  } catch (e) { return failure(e); }
}

export interface InviteView {
  token: string;
  projectId: string;
  ownerPlan: string;
  /** Роль по умолчанию, которую даёт ссылка. */
  role: 'edit' | 'view';
  isOwner: boolean;
  allowCopy: boolean;
  pageRights?: Record<string, PageRight>;
  roomCode: string;
  rev: number;
  project: Project;
}

/** Приглашение /j/:token: права, комната и проект (отфильтрованный сервером). */
export async function loadInvite(api: ApiClient, token: string, store: AssetStore = assetStore): Promise<CloudResult<InviteView>> {
  try {
    const r = await api.request<InviteView>('GET', `/api/invites/${encodeURIComponent(token)}`);
    return { ok: true, value: { ...r, project: await hydrateFromCloud(r.project, api, store) } };
  } catch (e) { return failure(e); }
}

export type CloneFailure = 'clone-forbidden' | 'plan-limit-projects' | CloudFailure;

/** Клонирование на сервере; в ответе копия с картинками на месте. */
export async function cloneOnServer(
  api: ApiClient, projectId: string, inviteToken?: string, store: AssetStore = assetStore,
): Promise<{ ok: true; project: Project; rev: number } | { ok: false; reason: CloneFailure }> {
  try {
    const q = inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : '';
    const r = await api.request<{ project: Project; rev: number }>('POST', `/api/projects/${encodeURIComponent(projectId)}/clone${q}`);
    return { ok: true, project: await hydrateFromCloud(r.project, api, store), rev: r.rev };
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && (e.code === 'clone-forbidden' || e.code === 'plan-limit-projects')) return { ok: false, reason: e.code };
    return failure(e);
  }
}
