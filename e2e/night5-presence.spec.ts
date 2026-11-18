// Ночь №5, блок 4: присутствие — краевые курсоры с перелётом камеры, «Позвать всех сюда» и автопереход гостей
// за автором с заходом автора на скрытую страницу (облачная комната настоящего сервера Abax; лимиты тарифов на
// сервере выключены — комната ведёт себя как Pro).
import { expect, test, type Page } from '@playwright/test';
import { Board } from './fixtures';
import { createInvite, device, openAt, shareTab, stateOf, useNight5Server } from './night5-helpers';

const env = useNight5Server();

const pageIdOf = (p: Page) => stateOf(p, s => s.pageId as string);

/** Переход на страницу по номеру — карточкой в доке страниц. */
async function goToPage(page: Page, index: number): Promise<void> {
  const board = new Board(page);
  await board.openPages();
  await page.locator('#pages-list .page-item').nth(index).click();
  const id = await stateOf(page, s => s.project.pages.map((p: any) => p.id));
  await expect.poll(() => pageIdOf(page)).toBe((id as string[])[index]);
}

async function closeShare(page: Page): Promise<void> {
  if (await page.locator('#share-dialog').count() > 0) await page.locator('#btn-share').click();
  await expect(page.locator('#share-dialog')).toHaveCount(0);
}

test.describe('присутствие', () => {
  test('краевой курсор: гость за краем экрана автора — стрелка у края, клик переносит камеру к нему', async ({ browser }) => {
    const { base } = env.get();
    const A = await device(browser, base, { name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await new Board(a).rect(400, 300, 520, 380);
    const link = await createInvite(a);
    await closeShare(a);
    const G = await device(browser, base, { name: 'Капибара' });
    const g = await openAt(G, link, env.errors, 'guest');
    await expect.poll(() => pageIdOf(g)).toBe(await pageIdOf(a));

    // гость уехал камерой далеко вправо и водит там курсором
    await g.evaluate(() => { const d = (window as any).__doska; d.state.camera.x += 6000; d.requestRender(); });
    const box = (await g.locator('#board').boundingBox())!;
    await g.mouse.move(box.x + 600, box.y + 400);
    await g.mouse.move(box.x + 620, box.y + 410, { steps: 3 });

    const edge = a.locator('.collab-edge-pointer');
    await expect(edge).toHaveCount(1, { timeout: 10000 });
    const eb = (await edge.boundingBox())!;
    const ab = (await a.locator('#board').boundingBox())!;
    // стрелка прижата к правому краю экрана автора
    expect(eb.x + eb.width / 2).toBeGreaterThan(ab.x + ab.width * 0.75);
    const camBefore = await stateOf(a, s => s.camera.x as number);
    await edge.click();
    await expect.poll(() => stateOf(a, s => s.camera.x as number), { timeout: 5000 }).toBeGreaterThan(camBefore + 4000);
    // гость теперь на экране — краевой курсор пропал, обычный курсор с именем виден
    await expect(edge).toHaveCount(0, { timeout: 5000 });
    await expect(a.locator('.remote-cursor span', { hasText: 'Капибара' })).toBeVisible();
    await A.close();
    await G.close();
  });

  test('«Позвать всех сюда» и автопереход: гость идёт за автором, кроме скрытой страницы', async ({ browser }) => {
    const { base } = env.get();
    const A = await device(browser, base, { name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    const boardA = new Board(a);
    await boardA.rect(400, 300, 520, 380);
    await boardA.addPage();
    await boardA.addPage();
    const pages = await stateOf(a, s => s.project.pages.map((p: any) => p.id as string)) as string[];
    expect(pages).toHaveLength(3);
    const link = await createInvite(a);
    // вторая страница скрыта от гостей
    await shareTab(a, 'settings'); // Ночь №6: права страниц — на вкладке «Настройки доступа»
    await a.locator(`#share-dialog .share-page-right[data-page-id="${pages[1]}"] select`).selectOption('hidden');
    await closeShare(a);

    const G = await device(browser, base, { name: 'Капибара' });
    const g = await openAt(G, link, env.errors, 'guest');
    await goToPage(a, 0);
    await expect.poll(() => stateOf(g, s => s.project.pages.length)).toBe(2);
    await goToPage(g, 0);

    // автор на третьей странице зовёт всех
    await goToPage(a, 2);
    expect(await pageIdOf(g)).toBe(pages[0]);
    await a.locator('#btn-summon').click();
    await expect.poll(() => pageIdOf(g), { timeout: 10000 }).toBe(pages[2]);
    await expect(g.locator('#activity-pills .activity-pill', { hasText: 'Автор позвал всех на страницу' })).toBeVisible();
    // аватар гостя — у карточки третьей страницы в доке автора
    await boardA.openPages();
    await expect(a.locator('#pages-list .page-item').nth(2).locator('.page-avatar')).toHaveCount(1, { timeout: 10000 });

    // автопереход: автор включает, уходит на первую — гость следом
    const follow = a.locator('#btn-follow');
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    await goToPage(a, 0);
    await expect.poll(() => pageIdOf(g), { timeout: 10000 }).toBe(pages[0]);

    // автор заходит на скрытую страницу: гость остаётся, у автора — напоминание, а гость видит «на скрытой странице»
    await goToPage(a, 1);
    await expect(a.locator('#follow-hidden-badge')).toBeVisible({ timeout: 5000 });
    await expect(a.locator('#follow-hidden-badge')).toContainText('участники остались на предыдущей странице');
    await expect(g.locator('#collab-presence .presence-avatar.on-hidden')).toHaveCount(1, { timeout: 10000 });
    expect(await pageIdOf(g)).toBe(pages[0]);

    // и уходит на открытую третью — гость переходит к нему
    await goToPage(a, 2);
    await expect.poll(() => pageIdOf(g), { timeout: 10000 }).toBe(pages[2]);
    await expect(a.locator('#follow-hidden-badge')).toBeHidden();
    await A.close();
    await G.close();
  });
});
