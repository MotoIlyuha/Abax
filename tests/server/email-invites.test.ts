// Приглашения по почте (SPEC_NIGHT5 §4.2): письмо со ссылкой, список у автора, отзыв, входящие у адресата.
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { memoryMailer, type Mailer } from '../../server/mailer';
import { EMAIL_INVITE_RATE, EMAIL_INVITE_RESEND_MS } from '../../server/email-invites';
import { anon, call, closeApps, makeApp, proj, putProject, setPlan } from './helpers';

afterEach(closeApps);

async function setup(over: Parameters<typeof makeApp>[0] = {}) {
  const mailer = memoryMailer();
  const app = await makeApp({ mailer, ...over });
  const owner = await anon(app);
  app.db.prepare("UPDATE users SET email = 'author@abax.ru', display_name = 'Анна' WHERE id = ?").run(owner.id);
  await putProject(app, owner.token, proj('a', { name: 'Алгебра' }));
  return { app, mailer, owner };
}

/** Пользователь, вошедший с этим адресом (почтой или через Google). */
async function userWith(app: Awaited<ReturnType<typeof makeApp>>, column: 'email' | 'google_email', email: string) {
  const u = await anon(app);
  if (column === 'google_email') app.db.prepare("UPDATE users SET google_sub = ?, google_email = ? WHERE id = ?").run(`g-${u.id}`, email, u.id);
  else app.db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, u.id);
  return u;
}

const invite = (app: { base: string }, token: string, body: unknown, projectId = 'a') =>
  call(app, 'POST', `/api/projects/${projectId}/email-invites`, body, { token });

describe('приглашения по почте: автор', () => {
  it('письмо со ссылкой, запись в списке, отдельный токен вида email', async () => {
    const { app, mailer, owner } = await setup();
    const r = await invite(app, owner.token, { email: '  Student@Example.com ', role: 'view' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ created: true, mailed: true, invite: { email: 'student@example.com', role: 'view', status: 'pending', projectId: 'a' } });
    expect(mailer.outbox).toHaveLength(1);
    const mail = mailer.outbox[0];
    expect(mail.to).toBe('student@example.com');
    expect(mail.subject).toContain('Анна');
    expect(mail.subject).toContain('«Алгебра»');
    const token = (app.db.prepare('SELECT token FROM project_email_invites').get() as { token: string }).token;
    expect(mail.text).toContain(`https://abax.example/?route=collab&token=${token}`);
    expect(app.db.prepare('SELECT kind, default_role FROM invites WHERE token = ?').get(token)).toEqual({ kind: 'email', default_role: 'view' });
    // токен из письма открывает проект как обычная ссылка-приглашение
    expect((await call(app, 'GET', `/api/invites/${token}`)).body).toMatchObject({ projectId: 'a', role: 'view' });
    const list = await call(app, 'GET', '/api/projects/a/email-invites', undefined, { token: owner.token });
    expect(list.body.invites).toEqual([expect.objectContaining({ email: 'student@example.com', role: 'view', status: 'pending' })]);
    expect(JSON.stringify(list.body)).not.toContain(token); // токен автору не нужен
  });

  it('ошибки: адрес, роль, себя, чужой проект, без авторизации, почта выключена', async () => {
    const { app, owner } = await setup();
    expect((await invite(app, owner.token, { email: 'не адрес' })).body.error).toBe('bad-email');
    expect((await invite(app, owner.token, { email: 'a@b.ru', role: 'admin' })).body.error).toBe('bad-role');
    expect((await invite(app, owner.token, { email: 'Author@Abax.ru' })).body.error).toBe('self-invite');
    const other = await anon(app);
    expect((await invite(app, other.token, { email: 'x@y.ru' })).status).toBe(404);
    expect((await call(app, 'GET', '/api/projects/a/email-invites', undefined, { token: other.token })).status).toBe(404);
    expect((await call(app, 'POST', '/api/projects/a/email-invites', { email: 'x@y.ru' })).status).toBe(401);
    const noMail = await makeApp();
    const o2 = await anon(noMail);
    await putProject(noMail, o2.token, proj('b'));
    const r = await invite(noMail, o2.token, { email: 'x@y.ru' }, 'b');
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('mail-disabled');
  });

  it('повтор тому же адресу: роль обновляется, письмо - не чаще раза в 10 минут', async () => {
    const { app, mailer, owner } = await setup();
    await invite(app, owner.token, { email: 's@ex.ru', role: 'edit' });
    const again = await invite(app, owner.token, { email: 's@ex.ru', role: 'view' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, mailed: false, invite: { role: 'view' } });
    expect(mailer.outbox).toHaveLength(1);
    const token = (app.db.prepare('SELECT token FROM project_email_invites').get() as { token: string }).token;
    expect((app.db.prepare('SELECT default_role FROM invites WHERE token = ?').get(token) as { default_role: string }).default_role).toBe('view');
    app.clock.t += EMAIL_INVITE_RESEND_MS;
    expect((await invite(app, owner.token, { email: 's@ex.ru', role: 'view' })).body.mailed).toBe(true);
    expect(mailer.outbox).toHaveLength(2);
    expect(app.db.prepare('SELECT COUNT(*) AS n FROM project_email_invites').get()).toEqual({ n: 1 });
  });

  it('сбой почты: новое приглашение не остаётся, ответ 502', async () => {
    const failing: Mailer = { kind: 'memory', send: async () => { throw new Error('smtp down'); } };
    const { app, owner } = await setup({ mailer: failing });
    const r = await invite(app, owner.token, { email: 's@ex.ru' });
    expect(r.status).toBe(502);
    expect(app.db.prepare('SELECT COUNT(*) AS n FROM project_email_invites').get()).toEqual({ n: 0 });
    expect(app.db.prepare("SELECT COUNT(*) AS n FROM invites WHERE kind = 'email'").get()).toEqual({ n: 0 });
  });

  it('лимит 20 приглашений в час на автора', async () => {
    const { app, owner } = await setup();
    for (let i = 0; i < EMAIL_INVITE_RATE; i++) expect((await invite(app, owner.token, { email: `s${i}@ex.ru` })).status).toBe(201);
    expect((await invite(app, owner.token, { email: 'one-more@ex.ru' })).status).toBe(429);
  });

  it('приглашение по почте не выдаётся как ссылка проекта', async () => {
    const { app, owner } = await setup();
    await invite(app, owner.token, { email: 's@ex.ru' });
    expect((await call(app, 'GET', '/api/invites?projectId=a', undefined, { token: owner.token })).body.invite).toBeNull();
    const link = await call(app, 'POST', '/api/invites', { projectId: 'a' }, { token: owner.token });
    expect(link.body.created).toBe(true);
    const emailToken = (app.db.prepare('SELECT token FROM project_email_invites').get() as { token: string }).token;
    expect(link.body.token).not.toBe(emailToken);
    expect((await call(app, 'GET', '/api/invites?projectId=a', undefined, { token: owner.token })).body.invite.token).toBe(link.body.token);
  });

  it('отзыв: статус revoked, ссылка не открывается, подключённый гость отключается (4403)', async () => {
    const { app, owner } = await setup();
    setPlan(app, owner.id, 'pro'); // комната pro живёт без автора: гость входит сам
    const r = await invite(app, owner.token, { email: 's@ex.ru', role: 'edit' });
    const token = (app.db.prepare('SELECT token FROM project_email_invites').get() as { token: string }).token;
    const ws = new WebSocket(`${app.base.replace('http', 'ws')}/ws/room/a`);
    const msgs: any[] = [];
    const closed = new Promise<number>(res => ws.on('close', code => res(code)));
    ws.on('message', d => msgs.push(JSON.parse(d.toString())));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', proto: 1, invite: token })));
    for (let i = 0; i < 300 && !msgs.some(m => m.t === 'init'); i++) await new Promise(res => setTimeout(res, 10));
    expect(msgs.some(m => m.t === 'init')).toBe(true);
    const del = await call(app, 'DELETE', `/api/projects/a/email-invites/${r.body.invite.id}`, undefined, { token: owner.token });
    expect(del.status).toBe(200);
    expect(await closed).toBe(4403);
    expect((await call(app, 'GET', `/api/invites/${token}`)).status).toBe(404);
    expect((await call(app, 'GET', '/api/projects/a/email-invites', undefined, { token: owner.token })).body.invites).toEqual([]);
    expect((await call(app, 'DELETE', '/api/projects/a/email-invites/нет-такого', undefined, { token: owner.token })).status).toBe(404);
    // повторное приглашение после отзыва — новый токен
    const again = await invite(app, owner.token, { email: 's@ex.ru' });
    expect(again.body.invite.status).toBe('pending');
    expect((app.db.prepare('SELECT token FROM project_email_invites').get() as { token: string }).token).not.toBe(token);
  });
});

describe('приглашения по почте: адресат', () => {
  it('видит приглашение по почте входа и по подтверждённому адресу Google', async () => {
    const { app, owner } = await setup();
    await invite(app, owner.token, { email: 'student@example.com', role: 'view' });
    await invite(app, owner.token, { email: 'gmailer@gmail.com', role: 'edit' });
    const s = await userWith(app, 'email', 'student@example.com');
    const g = await userWith(app, 'google_email', 'gmailer@gmail.com');
    const a = (await call(app, 'GET', '/api/me/invites', undefined, { token: s.token })).body.invites;
    expect(a).toEqual([expect.objectContaining({ projectId: 'a', projectName: 'Алгебра', hostName: 'Анна', role: 'view' })]);
    expect(typeof a[0].token).toBe('string');
    const b = (await call(app, 'GET', '/api/me/invites', undefined, { token: g.token })).body.invites;
    expect(b).toEqual([expect.objectContaining({ projectId: 'a', role: 'edit' })]);
  });

  it('аноним и чужой адрес - пусто; удалённый проект не показывается', async () => {
    const { app, owner } = await setup();
    await invite(app, owner.token, { email: 'student@example.com' });
    const a = await anon(app);
    expect((await call(app, 'GET', '/api/me/invites', undefined, { token: a.token })).body.invites).toEqual([]);
    const other = await userWith(app, 'email', 'other@example.com');
    expect((await call(app, 'GET', '/api/me/invites', undefined, { token: other.token })).body.invites).toEqual([]);
    const s = await userWith(app, 'email', 'student@example.com');
    expect((await call(app, 'GET', '/api/me/invites', undefined, { token: s.token })).body.invites).toHaveLength(1);
    await call(app, 'DELETE', '/api/projects/a', undefined, { token: owner.token });
    expect((await call(app, 'GET', '/api/me/invites', undefined, { token: s.token })).body.invites).toEqual([]);
  });

  it('принять - токен и статус accepted; отклонить - declined; чужой ответить не может', async () => {
    const { app, owner } = await setup();
    const r1 = await invite(app, owner.token, { email: 'student@example.com' });
    const s = await userWith(app, 'email', 'student@example.com');
    const intruder = await userWith(app, 'email', 'intruder@example.com');
    const path = `/api/me/invites/${r1.body.invite.id}/respond`;
    expect((await call(app, 'POST', path, { action: 'accept' }, { token: intruder.token })).status).toBe(404);
    expect((await call(app, 'POST', path, { action: 'maybe' }, { token: s.token })).status).toBe(400);
    const ok = await call(app, 'POST', path, { action: 'accept' }, { token: s.token });
    expect(ok.body).toMatchObject({ ok: true, projectId: 'a' });
    const token = (app.db.prepare('SELECT token FROM project_email_invites').get() as { token: string }).token;
    expect(ok.body.token).toBe(token);
    expect((await call(app, 'GET', '/api/projects/a/email-invites', undefined, { token: owner.token })).body.invites[0].status).toBe('accepted');
    expect((await call(app, 'GET', '/api/me/invites', undefined, { token: s.token })).body.invites).toEqual([]); // уже не входящее

    await putProject(app, owner.token, proj('b', { name: 'Геометрия' }));
    const r2 = await invite(app, owner.token, { email: 'student@example.com' }, 'b');
    const no = await call(app, 'POST', `/api/me/invites/${r2.body.invite.id}/respond`, { action: 'decline' }, { token: s.token });
    expect(no.body).toEqual({ ok: true });
    expect((await call(app, 'GET', '/api/projects/b/email-invites', undefined, { token: owner.token })).body.invites[0].status).toBe('declined');
    // отказ не отзывает токен
    expect((await call(app, 'GET', `/api/invites/${(app.db.prepare("SELECT token FROM project_email_invites WHERE project_id = 'b'").get() as { token: string }).token}`)).status).toBe(200);
  });
});
