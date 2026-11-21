// Ночь №5, блок 3: приглашения — живые права страниц прямо под гостем, «Комната заполнена» с переходом
// к просмотру только для чтения и приглашение по почте внутри приложения.
import { expect, test } from '@playwright/test';
import { Board, pickOption } from './fixtures';
import { createInvite, device, login, openAt, shareTab, stateOf, useNight5Server, userIdOf } from './night5-helpers';

const env = useNight5Server();

test.describe('приглашения', () => {
  test('автор скрывает страницу под гостем - гость уходит на открытую; скрыты все - баннер ожидания; открыл - баннер ушёл', async ({ browser }) => {
    const { base } = env.get();
    const A = await device(browser, base, { name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    const boardA = new Board(a);
    await boardA.rect(400, 300, 520, 380);
    await boardA.addPage();
    await boardA.rect(300, 200, 360, 260);
    const pages = await stateOf(a, s => s.project.pages.map((p: any) => p.id as string)) as string[];
    expect(pages).toHaveLength(2);
    const link = await createInvite(a);

    const G = await device(browser, base, { name: 'Капибара' });
    const g = await openAt(G, link, env.errors, 'guest');
    await expect.poll(() => stateOf(g, s => s.project.pages.length)).toBe(2);
    const first = await stateOf(g, s => s.pageId as string);
    const other = pages.find(id => id !== first)!;

    // гость начал тянуть рамку выделения — автор скрывает его страницу прямо посреди жеста
    const box = (await g.locator('#board').boundingBox())!;
    await g.mouse.move(box.x + 700, box.y + 500);
    await g.mouse.down();
    await g.mouse.move(box.x + 800, box.y + 600, { steps: 3 });
    await shareTab(a, 'settings'); // права страниц — на странице «Настройки доступа»
    const right = (id: string) => a.locator(`#share-dialog .share-page-right[data-page-id="${id}"] .ss-trigger`);
    await pickOption(a, right(first), 'hidden');
    await expect.poll(() => stateOf(g, s => s.pageId as string), { timeout: 10000 }).toBe(other);
    await g.mouse.up();
    await expect(g.locator('#notify-stack .ns-card', { hasText: 'Автор скрыл страницу, на которой вы находились' })).toBeVisible();
    expect(await stateOf(g, s => s.project.pages.map((p: any) => p.id))).toEqual([other]);
    expect(await stateOf(g, s => [...s.selection].length)).toBe(0);

    // скрыты все страницы: холст закрыт баннером ожидания
    await pickOption(a, right(other), 'hidden');
    const banner = g.locator('#all-pages-hidden-banner');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await expect(banner).toContainText('Автор временно скрыл все страницы доски');
    await expect(g.locator('body')).toHaveClass(/all-pages-hidden/);

    // автор открывает первую страницу для просмотра — баннер уходит, гость на ней
    await pickOption(a, right(first), 'view');
    await expect(banner).toBeHidden({ timeout: 10000 });
    await expect(g.locator('body')).not.toHaveClass(/all-pages-hidden/);
    await expect.poll(() => stateOf(g, s => s.pageId as string)).toBe(first);
    await expect.poll(() => new Board(g).count('shape')).toBe(1);
    await A.close();
    await G.close();
  });

  test('«Комната заполнена»: Pro-автор пускает одного гостя - второй видит «1 из 1» и открывает доску только для чтения', async ({ browser }) => {
    const { srv, base } = env.get();
    const A = await device(browser, base, { name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await new Board(a).rect(400, 300, 520, 380);
    const uid = await userIdOf(a);
    srv.db.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").run(uid);
    const link = await createInvite(a);
    const pid = await stateOf(a, s => s.project.id as string);
    await expect.poll(() => stateOf(a, s => s.collabRole), { timeout: 15000 }).toBe('host');
    await shareTab(a, 'settings');
    // максимум гостей — счётчик: Home — наименьшее значение (1)
    await a.locator('#share-dialog [data-field="maxGuests"] [role="spinbutton"]').press('Home');
    await expect(a.locator('#share-dialog [data-field="maxGuests"]')).toHaveAttribute('data-value', '1');
    await expect.poll(() => srv.rooms.projectOf(pid)?.permissions?.maxGuests, { timeout: 10000 }).toBe(1);

    const G1 = await device(browser, base, { name: 'Капибара' });
    await openAt(G1, link, env.errors, 'guest');
    const G2 = await device(browser, base, { name: 'Вомбат' });
    const g2 = await openAt(G2, link, env.errors, 'none');
    const modal = g2.locator('#room-full-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal.locator('h2')).toHaveText('В комнате сейчас максимум участников (1 из 1)');
    await expect(modal).toContainText('Автор доски ограничил число участников');
    await expect(modal.locator('.room-full-retry')).toBeVisible();
    await modal.locator('.room-full-readonly').click();
    await expect(modal).toBeHidden();
    await expect(g2.locator('#link-banner')).toBeVisible();
    expect(await stateOf(g2, s => s.linkMode)).toBe('view-project');
    await expect.poll(() => new Board(g2).count('shape')).toBe(1);
    // слот в комнате он не занял
    expect(srv.rooms.connections(pid)).toBe(2);
    await A.close();
    await G1.close();
    await G2.close();
  });

  test('приглашение по почте: письмо со ссылкой, у адресата - карточка на домашнем экране, «Присоединиться» ведёт в комнату', async ({ browser }) => {
    const { srv, base, outbox } = env.get();
    const host = await login(base, 'mail-host@abax.example');
    const A = await device(browser, base, { session: host.token, name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await new Board(a).rect(400, 300, 520, 380);
    const pid = await stateOf(a, s => s.project.id as string);
    await expect.poll(() => (srv.db.prepare('SELECT rev FROM projects WHERE id = ?').get(pid) as { rev: number } | undefined)?.rev ?? 0, { timeout: 15000 }).toBeGreaterThan(0);

    await a.locator('#btn-share').click();
    const box = a.locator('#share-dialog .share-invite');
    const input = box.locator('.share-email-input');
    await expect(input).toBeVisible({ timeout: 15000 });
    await input.fill('Student@Abax.example');
    await pickOption(a, box.locator('.share-email-role'), 'reader'); // Ночь №6: роли Редактор / Комментатор / Читатель
    await box.locator('.share-email-send').click();
    const item = box.locator('.share-email-item');
    await expect(item).toHaveCount(1, { timeout: 10000 });
    await expect(item.locator('.share-email-addr')).toHaveText('student@abax.example');
    await expect(item.locator('.share-email-row-role')).toHaveAttribute('data-value', 'reader');
    const mail = outbox.find(m => m.to === 'student@abax.example');
    expect(mail?.text).toMatch(/\?route=collab&token=[A-Za-z0-9_-]+/);

    // адресат входит с этим адресом на своём устройстве
    const student = await login(base, 'student@abax.example');
    const S = await device(browser, base, { session: student.token, name: 'Капибара' });
    const s = await openAt(S, `${base}/`, env.errors);
    await new Board(s).home();
    const card = s.locator('#home .home-invites .invite-card');
    await expect(card).toHaveCount(1, { timeout: 10000 });
    await expect(card).toContainText('Проект 1');
    await expect(s.locator('.home-profile')).toHaveClass(/has-invites/);
    await card.locator('.invite-join').click();
    await expect(s.locator('body')).toHaveClass(/collab-guest/, { timeout: 15000 });
    await expect.poll(() => stateOf(s, st => st.project.id as string)).toBe(pid);
    await expect(s.locator('body')).toHaveClass(/readonly-mode/);
    expect((srv.db.prepare('SELECT status FROM project_email_invites WHERE email = ?').get('student@abax.example') as { status: string }).status).toBe('accepted');

    // автор отзывает — гостя отключает
    await pickOption(a, item.locator('.share-email-row-role'), '__revoke', { verify: false }); // «Отозвать приглашение» — в списке роли
    await expect(item).toHaveCount(0, { timeout: 10000 });
    await expect(s.locator('#collab-notice')).toBeVisible({ timeout: 10000 });
    await A.close();
    await S.close();
  });
});
