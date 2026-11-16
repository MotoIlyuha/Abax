import type { PageRight } from '../src/types';
import { isPageRight } from '../src/limits';
import type { AppContext } from './context';
import type { InviteRow } from './db';

// Ссылки совместной работы: поиск действующего приглашения и его права. Маршруты — ниже по файлу.

export interface InviteRights {
  token: string;
  projectId: string;
  defaultRole: 'edit' | 'view';
  allowCopy: boolean;
  pageRights: Record<string, PageRight>;
}

export function parsePageRights(json: string): Record<string, PageRight> {
  try {
    const raw = JSON.parse(json) as unknown;
    const out: Record<string, PageRight> = {};
    if (raw && typeof raw === 'object') for (const [id, r] of Object.entries(raw)) if (isPageRight(r)) out[id] = r;
    return out;
  } catch { return {}; }
}

export function rightsOfInvite(row: InviteRow): InviteRights {
  return {
    token: row.token, projectId: row.project_id,
    defaultRole: row.default_role === 'view' ? 'view' : 'edit',
    allowCopy: row.allow_copy !== 0,
    pageRights: parsePageRights(row.page_rights_json),
  };
}

/** Действующее приглашение (не отозвано, не просрочено); projectId — если оно должно относиться к этому проекту. */
export function findActiveInvite(app: AppContext, token: string, projectId?: string): InviteRights | null {
  if (typeof token !== 'string' || token === '' || token.length > 128) return null;
  const row = app.db.prepare('SELECT * FROM invites WHERE token = ?').get(token) as InviteRow | undefined;
  if (!row || row.revoked !== 0) return null;
  if (row.expires_at !== null && row.expires_at <= app.now()) return null;
  if (projectId !== undefined && row.project_id !== projectId) return null;
  return rightsOfInvite(row);
}
