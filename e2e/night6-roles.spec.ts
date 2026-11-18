// Ночь №6, роли (SPEC_NIGHT6 §2, §7.2, §8): урок — преподаватель (владелец), ученица по общей ссылке (Редактор),
// родитель по приглашению на почту (Читатель). Смена роли на лету; старая ссылка view работает как комментатор.
import { expect, test } from '@playwright/test';
import { Board } from './fixtures';
import { createInvite, device, login, openAt, shareTab, stateOf, useNight5Server } from './night5-helpers';

const env = useNight5Server();

test.describe('роли', () => {
  test('урок: редактор рисует, читатель только смотрит, скрытая страница не видна никому, автор видит, кто откуда', async ({ browser }) => {
    const { base, outbox, srv } = env.get();
    const teacher = await login(base, 'teacher-roles@abax.example');
    const A = await device(browser, base, { session: teacher.token, name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    const boardA = new Board(a);
    await boardA.rect(400, 300, 520, 380);
    await boardA.addPage();
    await boardA.addPage();
    const pages = await stateOf(a, s => s.project.pages.map((p: any) => p.id as string)) as string[];
    expect(pages).toHaveLength(3);
    const link = await createInvite(a, 'editor');
    // третья страница — «Решения» — скрыта от всех
    await shareTab(a, 'settings');
    await a.locator(`#share-dialog .share-page-right[data-page-id="${pages[2]}"] select`).selectOption('hidden');
    // родитель — читатель по почте
    await shareTab(a, 'share');
    const box = a.locator('#share-dialog .share-invite');
    await box.locator('.share-email-input').fill('parent@abax.example');
    await box.locator('.share-email-role').selectOption('reader');
    await box.locator('.share-email-send').click();
    await expect(box.locator('.share-email-item')).toHaveCount(1, { timeout: 10000 });
    const mail = outbox.find(m => m.to === 'parent@abax.example')!;
    const mailLink = /https?:\/\/\S+token=[A-Za-z0-9_-]+/.exec(mail.text)![0];

    // ученица по общей ссылке — редактор
    const S = await device(browser, base, { name: 'Аня' });
    const s = await openAt(S, link, env.errors, 'guest');
    await expect.poll(() => stateOf(s, st => st.project.pages.length), { timeout: 10000 }).toBe(2);
    await expect(s.locator('#toolbar')).toBeVisible();
    await expect(s.locator('body')).not.toHaveClass(/readonly-mode/);
    await new Board(s).rect(100, 100, 160, 160);
    const pid = await stateOf(a, st => st.project.id as string);
    // автор сейчас на третьей странице — правку ученицы видно в комнате
    await expect.poll(() => srv.rooms.projectOf(pid)?.pages[0].elements.length ?? 0, { timeout: 10000 }).toBe(2);

    // родитель — читатель: смотрит, но не комментирует, не пишет в чат и не пользуется указкой
    const P = await device(browser, base, { name: 'Пётр' });
    const p = await openAt(P, mailLink, env.errors, 'guest');
    await expect.poll(() => stateOf(p, st => st.project.pages.length), { timeout: 10000 }).toBe(2);
    await expect(p.locator('body')).toHaveClass(/readonly-mode/);
    await expect.poll(() => stateOf(p, st => st.board.elements.length), { timeout: 10000 }).toBe(2);
    await p.locator('#btn-chat').click();
    await expect(p.locator('.chat-input')).toBeHidden();
    await expect(p.locator('.chat-hint')).toHaveText('Читатели не пишут в чат');
    await p.keyboard.press('Escape');
    // выделить можно (копирование не запрещено), но реакций и «Комментировать» у читателя нет
    await new Board(p).click({ x: 460, y: 340 });
    await expect.poll(() => stateOf(p, st => st.selection.size)).toBe(1);
    await expect(p.locator('.qm-react')).toHaveCount(0);
    await expect(p.locator('.qm-comment')).toHaveCount(0);

    // автор видит, кто на доске и откуда у него доступ
    const present = box.locator('.share-present');
    await expect(present.locator('.share-person', { hasText: 'Аня' })).toContainText('Редактор · по общей ссылке', { timeout: 10000 });
    await expect(present.locator('.share-person', { hasText: 'Пётр' })).toContainText('Читатель · по приглашению parent@abax.example');
    // последний вход по письму виден в «У кого есть доступ»
    await expect(box.locator('.share-email-item .share-email-meta')).toContainText('заходил(а) сегодня', { timeout: 10000 });

    // смена роли общей ссылки на лету: ученица становится читателем
    await box.locator('select.share-link-role').selectOption('reader');
    await expect(s.locator('#activity-pills .activity-pill', { hasText: 'Автор изменил вашу роль: Читатель' })).toBeVisible({ timeout: 10000 });
    await expect(s.locator('body')).toHaveClass(/readonly-mode/);
    for (const ctx of [A, S, P]) await ctx.close();
  });

  test('старая ссылка «смотрят» (view) — комментатор, как раньше: пишет в чат и ставит реакции, но не рисует', async ({ browser }) => {
    const { base, srv } = env.get();
    const teacher = await login(base, 'teacher-legacy@abax.example');
    const A = await device(browser, base, { session: teacher.token, name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await new Board(a).rect(400, 300, 520, 380);
    const pid = await stateOf(a, st => st.project.id as string);
    await expect.poll(() => (srv.db.prepare('SELECT rev FROM projects WHERE id = ?').get(pid) as { rev: number } | undefined)?.rev ?? 0, { timeout: 15000 }).toBeGreaterThan(0);
    const token = 'LegacyViewTokenNight5xx1';
    srv.db.prepare("INSERT INTO invites (token, project_id, created_by, default_role, allow_copy, page_rights_json, created_at) VALUES (?, ?, ?, 'view', 1, '{}', 1)").run(token, pid, teacher.id);
    // автор в комнате, чтобы гостю было куда войти
    await createInvite(a);
    const G = await device(browser, base, { name: 'Ученик' });
    const g = await openAt(G, `${base}/?route=collab&token=${token}`, env.errors, 'guest');
    await expect(g.locator('body')).toHaveClass(/readonly-mode/);
    await expect.poll(() => stateOf(g, st => st.board.elements.length), { timeout: 10000 }).toBe(1);
    await g.locator('#btn-chat').click();
    await expect(g.locator('.chat-input')).toBeVisible();
    await g.locator('.chat-input').fill('можно вопрос?');
    await g.locator('.chat-input').press('Enter');
    await expect(a.locator('#activity-pills .activity-pill', { hasText: 'можно вопрос?' })).toBeVisible({ timeout: 10000 });
    await g.keyboard.press('Escape');
    await new Board(g).click({ x: 460, y: 340 });
    await expect(g.locator('.qm-react').first()).toBeVisible();
    await A.close();
    await G.close();
  });
});
