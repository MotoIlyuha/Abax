// «Следить за участником»: мой экран повторяет страницу и камеру участника; плашка «Следим за …» сверху посередине;
// скрытая от меня страница — ждём на месте; выход — своё перемещение по холсту (облачная комната сервера Abax).
import { expect, test, type Page } from '@playwright/test';
import { Board } from './fixtures';
import { createInvite, device, openAt, stateOf, useNight5Server } from './night5-helpers';

const env = useNight5Server();
const shots = process.env.FOLLOW_SHOTS ?? '';

const pageIdOf = (p: Page) => stateOf(p, s => s.pageId as string);
const camOf = (p: Page) => stateOf(p, s => ({ ...s.camera }) as { x: number; y: number; zoom: number });

async function closeShare(page: Page): Promise<void> {
  if (await page.locator('#share-dialog').count() > 0) await page.locator('#btn-share').click();
  await expect(page.locator('#share-dialog')).toHaveCount(0);
}

/** Протащить холст средней кнопкой мыши на (dx, dy). */
async function pan(p: Page, dx: number, dy: number): Promise<void> {
  const b = (await p.locator('#board').boundingBox())!;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await p.mouse.move(x, y);
  await p.mouse.down({ button: 'middle' });
  await p.mouse.move(x + dx, y + dy, { steps: 6 });
  await p.mouse.up({ button: 'middle' });
}

test('следить за участником: камера, страницы, скрытая страница, выход перемещением', async ({ browser }) => {
  const { base } = env.get();
  const A = await device(browser, base, { name: 'Лемур' });
  const a = await openAt(A, `${base}/`, env.errors);
  const boardA = new Board(a);
  await boardA.rect(400, 300, 520, 380);
  await boardA.addPage();
  await boardA.addPage();
  await boardA.openPages();
  await a.locator('#pages-list .page-item').nth(0).click();
  const link = await createInvite(a);
  await closeShare(a);
  const pages = await stateOf(a, s => s.project.pages.map((p: any) => p.id as string)) as string[];

  const G = await device(browser, base, { name: 'Капибара' });
  const g = await openAt(G, link, env.errors, 'guest');
  await expect.poll(() => pageIdOf(g)).toBe(pages[0]);

  // автор скрывает от Капибары третью страницу
  const group = a.locator('#collab-presence .avatar-group');
  const menuA = a.locator('#avatar-menu');
  await expect(group.locator('.user-avatar')).toHaveCount(2, { timeout: 10000 });
  await group.hover();
  await group.locator('.user-avatar[aria-label^="Капибара"]').click();
  await menuA.locator('[data-action="access"]').click();
  await menuA.locator('.avatar-access-row').nth(2).locator('.avatar-access-select').click();
  await a.locator('.ss-menu .ss-opt', { hasText: 'Скрыта' }).click();
  await expect.poll(() => stateOf(g, s => s.project.pages.length as number), { timeout: 10000 }).toBe(2);
  await a.keyboard.press('Escape');
  await a.keyboard.press('Escape');
  await expect(menuA).toHaveCount(0);

  // Капибара следит за автором
  const groupG = g.locator('#collab-presence .avatar-group');
  const menuG = g.locator('#avatar-menu');
  await expect(groupG.locator('.user-avatar')).toHaveCount(2, { timeout: 10000 });
  await groupG.hover();
  await groupG.locator('.user-avatar[aria-label^="Лемур"]').click();
  await menuG.locator('[data-action="follow"]').click();
  const banner = g.locator('#follow-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText('Следим за Лемур');
  // имя — цветом бейджа автора, плашка — сверху посередине
  const nameBg = await banner.locator('.follow-name').evaluate(e => getComputedStyle(e).backgroundColor);
  expect(nameBg).not.toBe('rgba(0, 0, 0, 0)');
  const bb = (await banner.boundingBox())!;
  const vw = g.viewportSize()!.width;
  expect(Math.abs(bb.x + bb.width / 2 - vw / 2)).toBeLessThan(2);
  expect(bb.y).toBeLessThan(120);
  if (shots) await g.screenshot({ path: `${shots}/follow-banner.png`, clip: { x: vw / 2 - 260, y: 0, width: 520, height: 140 } });

  // автор двигает камеру — за ним едет и экран Капибары (центр экрана и масштаб)
  await pan(a, -300, -200);
  const camA = await camOf(a);
  const centerOf = (p: Page) => stateOf(p, s => {
    const r = document.getElementById('board')!.getBoundingClientRect();
    return { x: s.camera.x + r.width / 2 / s.camera.zoom, y: s.camera.y + r.height / 2 / s.camera.zoom };
  });
  // у панорамы автора есть инерция — сравниваем текущие центры обоих экранов
  await expect.poll(async () => {
    const [ca, cg] = [await centerOf(a), await centerOf(g)];
    return Math.hypot(cg.x - ca.x, cg.y - ca.y);
  }, { timeout: 10000 }).toBeLessThan(1);
  expect((await camOf(g)).zoom).toBeCloseTo(camA.zoom, 5);
  expect((await centerOf(g)).x).toBeGreaterThan(900);

  // автор перешёл на вторую страницу — Капибара тоже
  await boardA.openPages();
  await a.locator('#pages-list .page-item').nth(1).click();
  await expect.poll(() => pageIdOf(g), { timeout: 10000 }).toBe(pages[1]);
  await expect(banner).toBeVisible();

  // третья страница скрыта от Капибары: она остаётся на второй, слежение продолжается
  await a.locator('#pages-list .page-item').nth(2).click();
  await expect.poll(() => pageIdOf(a)).toBe(pages[2]);
  await expect(banner).toContainText('на скрытой странице', { timeout: 10000 });
  expect(await pageIdOf(g)).toBe(pages[1]);
  // вернулся на первую — Капибара снова за ним
  await a.locator('#pages-list .page-item').nth(0).click();
  await expect.poll(() => pageIdOf(g), { timeout: 10000 }).toBe(pages[0]);
  await expect(banner).toHaveText('Следим за Лемур');

  // в меню аватара — «Перестать следить»
  await groupG.hover();
  await groupG.locator('.user-avatar[aria-label^="Лемур"]').click();
  await expect(menuG.locator('[data-action="follow"]')).toContainText('Перестать следить');
  await g.keyboard.press('Escape');
  await expect(menuG).toHaveCount(0);

  // Капибара сама сдвинула холст — слежение выключилось, камера автора её больше не двигает
  await g.waitForTimeout(500);
  await pan(g, 120, 80);
  await expect(banner).toBeHidden();
  await g.waitForTimeout(800); // своя инерция
  const camG = await camOf(g);
  await pan(a, 250, 250);
  await a.waitForTimeout(1200);
  expect(await camOf(g)).toEqual(camG);

  // колесо мыши тоже выключает слежение
  await groupG.hover();
  await groupG.locator('.user-avatar[aria-label^="Лемур"]').click();
  await menuG.locator('[data-action="follow"]').click();
  await expect(banner).toBeVisible();
  const b = (await g.locator('#board').boundingBox())!;
  await g.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await g.mouse.wheel(0, 100);
  await expect(banner).toBeHidden();

  await A.close();
  await G.close();
});
