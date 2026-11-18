import { randomBytes, randomUUID } from 'node:crypto';
import { requireUser } from './auth';
import { normalizeEmail } from './auth-flows';
import type { AppContext } from './context';
import type { EmailInviteRow, UserRow } from './db';
import { inviteUrl } from './invite-routes';
import { isStoredRole, legacyRoleOf, normalizeRole } from '../src/access';
import { getActiveProject } from './projects';
import { HttpError, type Router } from './router';
import { isAnonymousUser } from './users';

// Приглашения по почте (SPEC_NIGHT5 §4.2): у каждого — своя строка invites (kind = 'email') со своей ролью;
// ссылка из письма работает как обычная ссылка-приглашение. Адресат видит приглашение и внутри приложения,
// когда входит с этим адресом (почта или подтверждённый адрес Google).

/** Повторное письмо тому же адресу — не чаще. */
export const EMAIL_INVITE_RESEND_MS = 10 * 60_000;
/** Сколько приглашений по почте владелец может отправить за час. */
export const EMAIL_INVITE_RATE = 20;

const newToken = (): string => randomBytes(18).toString('base64url');

/** Приглашение для автора: роль как хранится (включая старые синонимы), статус и последний вход по его ссылке. */
function emailInviteJson(r: EmailInviteRow & { last_used_at?: number | null }) {
  return {
    id: r.id, projectId: r.project_id, email: r.email, role: r.role, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at ?? null,
  };
}

const EMAIL_INVITE_SELECT = 'SELECT ei.*, i.last_used_at FROM project_email_invites ei LEFT JOIN invites i ON i.token = ei.token';

/** Адреса, по которым пользователь получает приглашения: почта входа и подтверждённый адрес Google. */
function addressesOf(user: UserRow): string[] {
  if (isAnonymousUser(user)) return [];
  return [...new Set([user.email, user.google_email].filter((x): x is string => typeof x === 'string' && x !== ''))];
}

function ownProject(ctx: { app: AppContext }, user: UserRow, projectId: string) {
  const row = getActiveProject(ctx.app, projectId);
  if (!row || row.owner_id !== user.id) throw new HttpError(404, 'project-not-found');
  return row;
}

async function sendInviteMail(app: AppContext, to: string, hostName: string, projectName: string, role: string, token: string): Promise<void> {
  const r = normalizeRole(role);
  const what = !r || legacyRoleOf(r.role) === 'view' ? 'посмотреть доску' : 'поработать вместе на доске';
  await app.mailer!.send({
    to,
    subject: `${hostName} приглашает вас на доску «${projectName}» в Abax`,
    text: `${hostName} приглашает вас ${what} «${projectName}» в Abax.\n\nОткрыть доску: ${inviteUrl(app, token)}\n\n`
      + 'Приглашение будет видно и в самом Abax, если вы войдёте с этим адресом почты. Если вы не ждали письма, просто проигнорируйте его.',
  });
}

export function registerEmailInviteRoutes(router: Router): void {
  router.post('/api/projects/:id/email-invites', async ctx => {
    const user = requireUser(ctx);
    const app = ctx.app;
    const row = ownProject(ctx, user, ctx.params.id);
    const body = await ctx.body() as { email?: unknown; role?: unknown } | undefined;
    const email = normalizeEmail(body?.email);
    if (!email) throw new HttpError(400, 'bad-email');
    // роли Ночи №6 (редактор, комментатор, читатель) и старые синонимы edit/view
    const role = body?.role === undefined ? 'editor' : body.role;
    if (!isStoredRole(role)) throw new HttpError(400, 'bad-role');
    if (addressesOf(user).includes(email)) throw new HttpError(400, 'self-invite');
    if (!app.mailer) throw new HttpError(503, 'mail-disabled');
    if (!app.rateLimit(`email-invite:${user.id}`, EMAIL_INVITE_RATE, 3600_000)) throw new HttpError(429, 'rate-limited');

    const now = app.now();
    const existing = app.db.prepare('SELECT * FROM project_email_invites WHERE project_id = ? AND email = ?').get(row.id, email) as EmailInviteRow | undefined;
    let invite: EmailInviteRow;
    let created = false;
    let roleChanged = false;
    if (!existing || existing.status === 'revoked' || existing.status === 'declined') {
      // новое приглашение или повтор после отзыва/отказа — новый токен
      const token = newToken();
      app.db.transaction(() => {
        app.db.prepare("INSERT INTO invites (token, project_id, created_by, default_role, allow_copy, page_rights_json, created_at, kind) VALUES (?, ?, ?, ?, 1, '{}', ?, 'email')")
          .run(token, row.id, user.id, role, now);
        if (existing) {
          app.db.prepare("UPDATE project_email_invites SET role = ?, token = ?, status = 'pending', updated_at = ?, mailed_at = NULL WHERE id = ?")
            .run(role, token, now, existing.id);
        } else {
          app.db.prepare("INSERT INTO project_email_invites (id, project_id, host_user_id, email, role, token, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)")
            .run(randomUUID(), row.id, user.id, email, role, token, now, now);
        }
      })();
      created = !existing;
    } else if (existing.role !== role) {
      app.db.prepare('UPDATE project_email_invites SET role = ?, updated_at = ? WHERE id = ?').run(role, now, existing.id);
      app.db.prepare('UPDATE invites SET default_role = ? WHERE token = ?').run(role, existing.token);
      roleChanged = true;
    }
    invite = app.db.prepare('SELECT * FROM project_email_invites WHERE project_id = ? AND email = ?').get(row.id, email) as EmailInviteRow;
    if (roleChanged) app.notifyAccessChanged({ projectId: row.id, kind: 'invite-updated', token: invite.token });

    let mailed = false;
    if (invite.mailed_at === null || now - invite.mailed_at >= EMAIL_INVITE_RESEND_MS) {
      try {
        await sendInviteMail(app, email, user.display_name || 'Автор', row.title || 'Без названия', role, invite.token);
        app.db.prepare('UPDATE project_email_invites SET mailed_at = ? WHERE id = ?').run(now, invite.id);
        mailed = true;
      } catch (e) {
        app.log(`Не удалось отправить приглашение: ${e instanceof Error ? e.message : String(e)}`);
        if (created) {
          app.db.prepare('DELETE FROM project_email_invites WHERE id = ?').run(invite.id);
          app.db.prepare('DELETE FROM invites WHERE token = ?').run(invite.token);
        }
        throw new HttpError(502, 'mail-failed');
      }
    }
    invite = app.db.prepare(`${EMAIL_INVITE_SELECT} WHERE ei.id = ?`).get(invite.id) as EmailInviteRow;
    return { status: created ? 201 : 200, json: { invite: emailInviteJson(invite), created, mailed } };
  });

  router.get('/api/projects/:id/email-invites', ctx => {
    const user = requireUser(ctx);
    const row = ownProject(ctx, user, ctx.params.id);
    const rows = ctx.app.db.prepare(`${EMAIL_INVITE_SELECT} WHERE ei.project_id = ? AND ei.status != 'revoked' ORDER BY ei.created_at`)
      .all(row.id) as EmailInviteRow[];
    return { json: { invites: rows.map(emailInviteJson) } };
  });

  router.delete('/api/projects/:id/email-invites/:inviteId', ctx => {
    const user = requireUser(ctx);
    const app = ctx.app;
    const row = ownProject(ctx, user, ctx.params.id);
    const inv = app.db.prepare('SELECT * FROM project_email_invites WHERE id = ? AND project_id = ?').get(ctx.params.inviteId, row.id) as EmailInviteRow | undefined;
    if (!inv) throw new HttpError(404, 'invite-not-found');
    app.db.transaction(() => {
      app.db.prepare("UPDATE project_email_invites SET status = 'revoked', updated_at = ? WHERE id = ?").run(app.now(), inv.id);
      app.db.prepare('UPDATE invites SET revoked = 1 WHERE token = ?').run(inv.token);
    })();
    // подключённый по этому приглашению участник отключается (как при отзыве ссылки)
    app.notifyAccessChanged({ projectId: row.id, kind: 'invite-revoked', token: inv.token });
    return { json: { ok: true } };
  });

  router.get('/api/me/invites', ctx => {
    const user = requireUser(ctx);
    const emails = addressesOf(user);
    if (emails.length === 0) return { json: { invites: [] } };
    const rows = ctx.app.db.prepare(`SELECT ei.*, p.title AS project_name, u.display_name AS host_name
      FROM project_email_invites ei
      JOIN projects p ON p.id = ei.project_id AND p.is_deleted = 0
      JOIN users u ON u.id = ei.host_user_id
      JOIN invites i ON i.token = ei.token AND i.revoked = 0
      WHERE ei.status = 'pending' AND ei.email IN (${emails.map(() => '?').join(',')}) AND ei.host_user_id != ?
      ORDER BY ei.updated_at DESC`).all(...emails, user.id) as (EmailInviteRow & { project_name: string; host_name: string })[];
    return {
      json: {
        invites: rows.map(r => ({
          id: r.id, projectId: r.project_id, projectName: r.project_name || 'Без названия', hostName: r.host_name || 'Автор',
          role: r.role, token: r.token, createdAt: r.created_at,
        })),
      },
    };
  });

  router.post('/api/me/invites/:inviteId/respond', async ctx => {
    const user = requireUser(ctx);
    const app = ctx.app;
    const body = await ctx.body() as { action?: unknown } | undefined;
    if (body?.action !== 'accept' && body?.action !== 'decline') throw new HttpError(400, 'bad-action');
    const inv = app.db.prepare('SELECT * FROM project_email_invites WHERE id = ?').get(ctx.params.inviteId) as EmailInviteRow | undefined;
    // чужое приглашение неотличимо от несуществующего
    if (!inv || !addressesOf(user).includes(inv.email) || inv.status === 'revoked' || !getActiveProject(app, inv.project_id)) {
      throw new HttpError(404, 'invite-not-found');
    }
    const status = body.action === 'accept' ? 'accepted' : 'declined';
    app.db.prepare('UPDATE project_email_invites SET status = ?, updated_at = ? WHERE id = ?').run(status, app.now(), inv.id);
    return { json: body.action === 'accept' ? { ok: true, token: inv.token, projectId: inv.project_id } : { ok: true } };
  });
}
