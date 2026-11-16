// Ночь №4: персональные курсоры — курсор над холстом, кнопка «Выделение», цвет выделения, курсор у других участников.
import type { Page } from '@playwright/test';
import { expect, test } from './host';
import { Board } from './fixtures';

/** Есть ли на холсте рядом с точкой сцены (x, y) пиксель нужного цвета (±tol по каналам). */
async function colorNear(page: Page, board: Board, x: number, y: number, rgb: [number, number, number], radius = 8, tol = 40): Promise<boolean> {
  const cam = (await board.state()).camera;
  const sx = (x - cam.x) * cam.zoom, sy = (y - cam.y) * cam.zoom;
  return page.evaluate(({ sx, sy, rgb, radius, tol }) => {
    const c = document.getElementById('board') as HTMLCanvasElement;
    const dpr = c.width / c.clientWidth;
    const ctx = c.getContext('2d')!;
    const x0 = Math.round((sx - radius) * dpr), y0 = Math.round((sy - radius) * dpr), size = Math.round(radius * 2 * dpr);
    const d = ctx.getImageData(x0, y0, size, size).data;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol && d[i + 3] > 200) return true;
    }
    return false;
  }, { sx, sy, rgb, radius, tol });
}

async function pickCursorInSettings(page: Page, id: string): Promise<void> {
  await page.keyboard.press('Control+Comma');
  await page.locator('.sd-nav-item', { hasText: 'Профиль' }).click();
  await page.locator(`#settings-dialog [data-cursor="${id}"]`).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toHaveCount(0);
}

test.describe('персональные курсоры', () => {
  test('курсор «Выделения» над холстом и иконка на панели меняются вместе с профилем', async ({ host, page }) => {
    const board = host.board;
    await board.tool('v');
    await expect(board.canvas).toHaveCSS('cursor', /^url\("data:image\/svg\+xml.*\) 3 2, default$/);
    const selectBtn = page.locator('#toolbar .tool[data-tool="select"]');
    await expect(selectBtn.locator('svg.cursor-icon')).toHaveCount(1);
    expect(await selectBtn.locator('svg.cursor-icon path').first().getAttribute('fill')).toBe('#ffffff');
    const before = await board.canvas.evaluate(c => getComputedStyle(c).cursor);

    await pickCursorInSettings(page, 'coral');
    await expect(selectBtn.locator('svg.cursor-icon path').first()).toHaveAttribute('fill', '#ffa8a8');
    const after = await board.canvas.evaluate(c => getComputedStyle(c).cursor);
    expect(after).not.toBe(before);
    expect(decodeURIComponent(after)).toContain('#ffa8a8');
    // у других инструментов — прежние курсоры
    await board.tool('p');
    await expect(board.canvas).toHaveCSS('cursor', 'crosshair');
  });

  test('рамка и ручки выделения — цвета курсора пользователя', async ({ host, page }) => {
    const board = host.board;
    const el = await board.rect(300, 200, 420, 300);
    await board.tool('v');
    await board.click({ x: 360, y: 250 });
    await expect.poll(async () => (await board.state()).selection).toEqual([el.id]);
    // правый нижний угол — ручка размера
    await expect.poll(() => colorNear(page, board, 420, 300, [50, 115, 245])).toBe(true); // #3273f5
    await pickCursorInSettings(page, 'coral'); // выделение #e03131
    await expect.poll(async () => (await board.state()).selection).toEqual([el.id]);
    await expect.poll(() => colorNear(page, board, 420, 300, [224, 49, 49])).toBe(true);
    expect(await colorNear(page, board, 420, 300, [50, 115, 245], 8, 25)).toBe(false);
  });

  test('Pro-курсор на free — только примерка: курсор не меняется', async ({ host, page }) => {
    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-nav-item', { hasText: 'Профиль' }).click();
    await expect(page.locator('#settings-dialog [data-cursor="neon"] .cp-pro')).toHaveText('PRO');
    await page.locator('#settings-dialog [data-cursor="neon"]').click();
    await expect(page.locator('#settings-dialog .cp-lock')).toContainText('Доступно в подписке Pro');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('doska.profile')!).cursorId)).toBe('default');
    await expect(host.page.locator('#toolbar .tool[data-tool="select"] svg.cursor-icon path').first()).toHaveAttribute('fill', '#ffffff');
  });

  test('в совместной работе виден курсор участника и бейдж цвета его курсора', async ({ host, browser }) => {
    const url = await host.share();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // у гостя — свой профиль с «Кораллом»
    await ctx.addInitScript(() => localStorage.setItem('doska.profile', JSON.stringify({ name: '', cursorId: 'coral', onboarded: true, updatedAt: 1 })));
    const page = await ctx.newPage();
    await page.goto(`${url}&name=${encodeURIComponent('Ученик')}`);
    const guest = new Board(page);
    // гость с правом просмотра панели инструментов не видит — ждём сам режим гостя
    await page.waitForFunction(() => !!(window as any).__doska);
    await expect(page.locator('body')).toHaveClass(/collab-guest/);
    await guest.move({ x: 300, y: 300 });
    await guest.move({ x: 350, y: 320 }, 5);
    const cursor = host.page.locator('#remote-cursors .remote-cursor', { hasText: 'Ученик' });
    await expect(cursor.locator('span')).toBeVisible();
    await expect(cursor.locator('.rc-arrow svg path').first()).toHaveAttribute('fill', '#ffa8a8');
    await expect(cursor.locator('span')).toHaveCSS('background-color', 'rgb(201, 42, 42)');
    // автор меняет курсор — гость видит новый
    await host.board.move({ x: 500, y: 400 });
    await pickCursorInSettings(host.page, 'lavender');
    await host.board.move({ x: 520, y: 410 }, 3);
    const hostCursor = page.locator('#remote-cursors .remote-cursor', { hasText: 'Автор' });
    await expect(hostCursor.locator('.rc-arrow svg path').first()).toHaveAttribute('fill', '#d0bfff');
    await expect(hostCursor.locator('span')).toHaveCSS('background-color', 'rgb(103, 65, 217)');
    await ctx.close();
  });
});
