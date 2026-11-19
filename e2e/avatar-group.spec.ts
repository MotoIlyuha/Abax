// Группа аватаров в шапке: стопка раскрывается наведением, меню своего и чужого аватара — скрыть курсор,
// позвать одного к себе, убрать из совместной работы (облачная комната настоящего сервера Abax).
import { expect, test, type Page } from '@playwright/test';
import { Board } from './fixtures';
import { createInvite, device, openAt, stateOf, useNight5Server } from './night5-helpers';

const env = useNight5Server();
const shots = process.env.AVATAR_SHOTS ?? '';

const pageIdOf = (p: Page) => stateOf(p, s => s.pageId as string);
const shot = async (p: Page, name: string): Promise<void> => {
  if (shots) await p.locator('#topbar').screenshot({ path: `${shots}/${name}.png` });
};

async function closeShare(page: Page): Promise<void> {
  if (await page.locator('#share-dialog').count() > 0) await page.locator('#btn-share').click();
  await expect(page.locator('#share-dialog')).toHaveCount(0);
}

test('группа аватаров: раскрытие, меню, скрыть курсор, позвать одного, убрать участника', async ({ browser }) => {
  const { base } = env.get();
  const A = await device(browser, base, { name: 'Лемур' });
  const a = await openAt(A, `${base}/`, env.errors);
  // один на доске — свой аватар всё равно виден, слева от «Поделиться»
  const strip = a.locator('#collab-presence');
  await expect(strip.locator('.user-avatar.self')).toHaveCount(1);
  const shareBox = (await a.locator('#btn-share').boundingBox())!;
  const stripBox = (await strip.boundingBox())!;
  expect(stripBox.x + stripBox.width).toBeLessThanOrEqual(shareBox.x);
  await shot(a, 'alone');
  const boardA = new Board(a);
  await boardA.rect(400, 300, 520, 380);
  await boardA.addPage();
  // после добавления автор на второй странице — возвращаемся на первую, куда придут гости
  await boardA.openPages();
  await a.locator('#pages-list .page-item').nth(0).click();
  const link = await createInvite(a);
  await closeShare(a);
  const pages = await stateOf(a, s => s.project.pages.map((p: any) => p.id as string)) as string[];

  const G1 = await device(browser, base, { name: 'Капибара' });
  const g1 = await openAt(G1, link, env.errors, 'guest');
  const G2 = await device(browser, base, { name: 'Енот Полоскун' });
  const g2 = await openAt(G2, link, env.errors, 'guest');
  await expect.poll(() => pageIdOf(g1)).toBe(pages[0]);
  await expect.poll(() => pageIdOf(a)).toBe(pages[0]);

  const group = a.locator('#collab-presence .avatar-group');
  await expect(group.locator('.user-avatar')).toHaveCount(3, { timeout: 10000 });
  await expect(group.locator('.user-avatar.self')).toHaveCount(1);
  await expect(group).toHaveAttribute('data-open', '0');
  // свёрнутая стопка: аватары не перекрываются
  const boxes = await group.locator('.user-avatar').evaluateAll(els => els.map(e => e.getBoundingClientRect()).map(r => ({ l: r.left, r: r.right })));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].l).toBeGreaterThanOrEqual(boxes[i - 1].r);
  await shot(a, 'collapsed');

  // наведение раскрывает
  await group.hover();
  await expect(group).toHaveAttribute('data-open', '1');
  await a.waitForTimeout(400);
  await shot(a, 'expanded');

  // свой аватар: меню с профилем, «Позвать всех к себе», «Скрыть курсоры других»
  await group.locator('.user-avatar.self').click();
  const menu = a.locator('#avatar-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-action="profile"]')).toBeVisible();
  await expect(menu.locator('[data-action="summon-all"]')).toBeVisible();
  await expect(menu.locator('[data-action="hide-cursors"]')).toBeVisible();
  await a.waitForTimeout(300);
  if (shots) await a.screenshot({ path: `${shots}/self-menu.png`, clip: { x: 900, y: 0, width: 540, height: 360 } });
  await a.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // курсор Капибары виден у автора; «Скрыть курсор» в меню её аватара — пропадает только он
  const b1 = (await g1.locator('#board').boundingBox())!;
  await g1.mouse.move(b1.x + 500, b1.y + 400);
  await g1.mouse.move(b1.x + 520, b1.y + 410, { steps: 3 });
  const capyCursor = a.locator('.remote-cursor span', { hasText: 'Капибара' });
  await expect(capyCursor).toBeVisible({ timeout: 10000 });
  await group.hover();
  const capy = group.locator('.user-avatar[aria-label^="Капибара"]');
  await capy.click();
  await expect(menu).toBeVisible();
  await expect(menu.locator('.avatar-menu-name')).toHaveText('Капибара');
  await expect(menu.locator('[data-action="follow"]')).toBeDisabled();
  await expect(menu.locator('[data-action="follow"]')).toHaveCSS('opacity', '0.5');
  if (shots) { await a.waitForTimeout(300); await a.screenshot({ path: `${shots}/other-menu.png`, clip: { x: 900, y: 0, width: 540, height: 420 } }); }
  await menu.locator('[data-action="hide-cursor"]').click();
  await expect(capyCursor).toHaveCount(0);
  await expect(capy).toHaveClass(/cursor-off/);

  // «Позвать к себе»: автор на второй странице зовёт только Капибару
  await a.keyboard.press('Escape');
  await boardA.openPages();
  await a.locator('#pages-list .page-item').nth(1).click();
  await expect.poll(() => pageIdOf(a)).toBe(pages[1]);
  await group.hover();
  await capy.click();
  await menu.locator('[data-action="summon"]').click();
  await expect.poll(() => pageIdOf(g1), { timeout: 10000 }).toBe(pages[1]);
  await expect(g1.locator('#activity-pills .activity-pill', { hasText: 'позвал вас на страницу' })).toBeVisible();
  expect(await pageIdOf(g2)).toBe(pages[0]);

  // «Убрать из совместной работы»: с подтверждением; гость видит причину, у автора аватар исчезает
  await group.hover();
  await group.locator('.user-avatar[aria-label^="Енот"]').click();
  const remove = menu.locator('[data-action="remove"]');
  await remove.click();
  await expect(remove).toContainText('Нажмите ещё раз');
  await remove.click();
  await expect(g2.locator('#collab-notice')).toContainText('Вас отключили от доски', { timeout: 10000 });
  await expect(group.locator('.user-avatar')).toHaveCount(2, { timeout: 10000 });

  await A.close();
  await G1.close();
  await G2.close();
});
