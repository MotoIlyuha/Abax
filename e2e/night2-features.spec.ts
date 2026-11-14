// Ночь №2: просмотр по ссылке, клонирование, патчи, задания, реакции и лимиты тарифов.
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const snap = (page: Page) => page.evaluate(() => {
  const s = (window as any).__doska.state;
  return { linkMode: s.linkMode as string | null, pageId: s.pageId as string, projectId: s.project.id as string, pages: s.project.pages.length as number };
});

/** Открыть доску по ссылке просмотра: панели инструментов там нет, поэтому ждём только состояние. */
async function openLink(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).__doska);
  await expect(page.locator('#link-banner')).toBeVisible();
}

test.describe('просмотр по ссылке', () => {
  test('ссылка на объекты наводит камеру и подсвечивает их', async ({ board, page }) => {
    await board.open();
    const el = await board.rect(400, 300, 500, 400);
    await board.saved();
    const s = await board.state();
    await openLink(page, `/?route=page&projectId=${s.project.id}&pageId=${s.pageId}&focus=${el.id}`);
    await expect.poll(async () => (await page.evaluate(() => (window as any).__doska.state.flashes.length))).toBe(1);
    const cam = await page.evaluate(() => (window as any).__doska.state.camera);
    expect(cam.zoom).toBeGreaterThan(2);
    // объект в центре окна
    const cx = cam.x + 1440 / (2 * cam.zoom);
    expect(Math.abs(cx - 450)).toBeLessThan(60);
  });

  test('просмотр проекта: правка запрещена, клонирование доступно, док страниц виден', async ({ board, page }) => {
    await board.open();
    await board.rect(400, 300, 500, 400);
    await board.saved();
    const s = await board.state();
    await openLink(page, `/?route=project&projectId=${s.project.id}`);
    expect((await snap(page)).linkMode).toBe('view-project');
    await expect(page.locator('#toolbar')).toBeHidden();
    await expect(page.locator('#btn-home')).toBeHidden();
    await expect(page.locator('#btn-pages')).toBeVisible();
    await expect(page.locator('#link-banner .lb-clone')).toBeVisible();

    // рисование, удаление и отмена ничего не меняют
    await board.drag([{ x: 600, y: 300 }, { x: 800, y: 400 }]);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    expect(await board.count()).toBe(1);
    await page.waitForTimeout(800);
    // в хранилище осталась та же доска
    const stored = await page.evaluate((id) => JSON.parse(localStorage.getItem(`doska.p.${id}`)!).pages[0].elements.length, s.project.id);
    expect(stored).toBe(1);
  });

  test('ссылка на страницу: нет дока страниц и кнопки клонирования', async ({ board, page }) => {
    await board.open();
    await board.rect(400, 300, 500, 400);
    await board.saved();
    const s = await board.state();
    await openLink(page, `/?route=page&projectId=${s.project.id}&pageId=${s.pageId}`);
    expect((await snap(page)).linkMode).toBe('view-page');
    await expect(page.locator('#btn-pages')).toBeHidden();
    await expect(page.locator('#link-banner .lb-clone')).toHaveCount(0);
  });

  test('нет проекта на устройстве — плашка и пустая доска', async ({ page }) => {
    await openLink(page, '/?route=project&projectId=net-takogo');
    await expect(page.locator('#link-banner')).toContainText('Проект недоступен на этом устройстве');
    await expect(page.locator('#link-banner .lb-clone')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__doska.state.board.elements.length)).toBe(0);
  });

  test('«Клонировать проект» сохраняет копию, возвращает инструменты и чистит адрес', async ({ board, page }) => {
    await board.open();
    await board.rect(400, 300, 500, 400);
    await board.saved();
    const s = await board.state();
    await openLink(page, `/?route=project&projectId=${s.project.id}`);
    await page.locator('#link-banner .lb-clone').click();
    await expect(page.locator('#toolbar')).toBeVisible();
    await expect(page.locator('#link-banner')).toBeHidden();
    const after = await snap(page);
    expect(after.linkMode).toBeNull();
    expect(after.projectId).not.toBe(s.project.id);
    expect(page.url()).not.toContain('route=');
    expect(await board.count('shape')).toBe(1);
    await board.saved();
    const names = await page.evaluate(() => (window as any).__doska.state.projects.map((m: any) => m.name));
    expect(names).toContain('Проект 1 (копия)');
    // теперь это обычная доска: рисовать можно
    await board.rect(600, 300, 700, 400);
    expect(await board.count('shape')).toBe(2);
  });

  test('меню экспорта копирует ссылки; ссылка на объекты — из меню выделения', async ({ board, page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await board.open();
    const el = await board.rect(400, 300, 500, 400);
    await board.tool('v');
    await board.click({ x: 400, y: 350 });
    await expect(board.quickMenu.locator('.qm-link')).toBeVisible();
    await board.quickMenu.locator('.qm-link').click();
    const focusLink = await page.evaluate(() => navigator.clipboard.readText());
    expect(focusLink).toContain('route=page');
    expect(focusLink).toContain(`focus=${el.id}`);

    await page.locator('#btn-export').click();
    await page.locator('#export-menu [data-action="link-project"]').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('route=project');
  });
});
