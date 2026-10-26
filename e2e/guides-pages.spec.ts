import { expect, test, type Board } from './fixtures';

type Pt = { x: number; y: number };

/** Направляющие, которые сейчас показаны (координаты сцены). */
function guides(board: Board): Promise<{ axis: string; at: number; from: number; to: number }[]> {
  return board.page.evaluate(() => (window as any).__doska.state.guides);
}

/** Тянет мышью от a к b и, не отпуская, отдаёт управление: проверить направляющие посреди жеста. */
async function holdDrag(board: Board, a: Pt, b: Pt): Promise<void> {
  const sa = await board.screen(a);
  const sb = await board.screen(b);
  await board.page.mouse.move(sa.x, sa.y);
  await board.page.mouse.down();
  await board.page.mouse.move((sa.x + sb.x) / 2, (sa.y + sb.y) / 2, { steps: 4 });
  await board.page.mouse.move(sb.x, sb.y, { steps: 4 });
}

/** Флажок настройки в поповере «Настройки доски». */
async function toggleSetting(board: Board, text: string): Promise<void> {
  await board.page.locator('#btn-settings').click();
  await board.page.locator('#settings-popover label', { hasText: text }).locator('input').click();
  await board.page.keyboard.press('Escape');
}

test.describe('направляющие выравнивания', () => {
  test('при переносе объект примагничивается к краю соседа, видна линия; настройкой выключается', async ({ board, page }) => {
    await board.rect(200, 200, 350, 300);
    await page.keyboard.press('Escape');
    const b = await board.rect(600, 450, 700, 560);
    expect((await board.state()).selection).toEqual([b.id]);
    // левый край — на 4 правее левого края соседа
    await holdDrag(board, { x: 650, y: 505 }, { x: 254, y: 505 });
    const g = await guides(board);
    expect(g).toContainEqual(expect.objectContaining({ axis: 'x', at: 200 }));
    expect(g.find(x => x.axis === 'x' && x.at === 200)).toMatchObject({ from: 200, to: 560 });
    await page.mouse.up();
    expect((await board.elements())[1]).toMatchObject({ x: 200, y: 450 });
    expect(await guides(board)).toEqual([]);
    await page.keyboard.press('Control+z');

    expect((await board.state()).settings.alignGuides).toBe(true);
    await toggleSetting(board, 'Направляющие выравнивания');
    expect((await board.state()).settings.alignGuides).toBe(false);
    await board.tool('v');
    await board.click({ x: 650, y: 505 });
    await holdDrag(board, { x: 650, y: 505 }, { x: 254, y: 505 });
    expect(await guides(board)).toEqual([]);
    await page.mouse.up();
    expect((await board.elements())[1]).toMatchObject({ x: 204 });

    await page.reload();
    await board.ready();
    expect((await board.state()).settings.alignGuides).toBe(false);
  });

  test('при изменении размера край примагничивается к краю соседа', async ({ board, page }) => {
    await board.rect(200, 200, 350, 300);
    await page.keyboard.press('Escape');
    await board.rect(200, 400, 300, 500);
    // правая ручка нижнего — почти под правым краем верхнего
    await holdDrag(board, { x: 300, y: 450 }, { x: 346, y: 470 });
    expect(await guides(board)).toContainEqual(expect.objectContaining({ axis: 'x', at: 350 }));
    await page.mouse.up();
    expect((await board.elements())[1]).toMatchObject({ x: 200, w: 150, h: 100 });
  });
});

test.describe('список страниц', () => {
  test('по настройке закрывается после выбора страницы', async ({ board, page }) => {
    await board.addPage();
    const dock = page.locator('#pages-dock');
    const cards = page.locator('#pages-list .page-item');
    await cards.nth(0).click();
    await expect.poll(async () => (await board.state()).pageId).toBe((await board.state()).project.pages[0].id);
    await expect(dock).toHaveClass(/open/); // по умолчанию остаётся открытым

    expect((await board.state()).settings.closePagesOnPick).toBe(false);
    await toggleSetting(board, 'Закрывать после выбора страницы');
    expect((await board.state()).settings.closePagesOnPick).toBe(true);
    await board.openPages();
    await cards.nth(1).click();
    await expect(dock).not.toHaveClass(/open/);
    await expect.poll(async () => (await board.state()).pageId).toBe((await board.state()).project.pages[1].id);
  });

  test('на превью текущей страницы — рамка видимой области', async ({ board, page }) => {
    await board.rect(400, 300, 600, 450);
    await board.addPage();
    await page.locator('#pages-list .page-item').nth(0).click();
    await board.settled();
    const active = page.locator('#pages-list .page-item.active .page-view');
    const other = page.locator('#pages-list .page-item:not(.active) .page-view');
    await expect(active).toBeVisible();
    await expect(other).toBeHidden();
    // без совместной работы — акцентным цветом, пунктиром
    await expect(active).toHaveCSS('border-top-style', 'dashed');
    await expect(active).toHaveCSS('border-top-color', 'rgb(50, 115, 245)');
    // рамка целиком на превью: когда камера успокоится, превью вписывает и её
    const thumb = (await page.locator('#pages-list .page-item.active .page-thumb').boundingBox())!;
    await expect.poll(async () => {
      const v = (await active.boundingBox())!;
      return v.x >= thumb.x - 1 && v.y >= thumb.y - 1
        && v.x + v.width <= thumb.x + thumb.width + 1 && v.y + v.height <= thumb.y + thumb.height + 1;
    }).toBe(true);
    const before = (await active.boundingBox())!;
    // приблизили так, что видна только часть прямоугольника, — рамка меньше превью
    for (let i = 0; i < 8; i++) await page.keyboard.press('Equal');
    await expect.poll(async () => (await active.boundingBox())!.width).toBeLessThan(before.width * 0.8);

    // настройка — в скрытом разделе «Экспериментальные» (см. e2e/experimental.spec.ts)
    expect((await board.state()).settings.thumbViewport).toBe(true);
    await page.evaluate(() => localStorage.setItem('doska.experiments', '1'));
    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-nav-item[data-section="experimental"]').click();
    await page.locator('#settings-dialog label', { hasText: 'Показывать на превью видимую область' }).locator('input').uncheck();
    await page.keyboard.press('Escape');
    expect((await board.state()).settings.thumbViewport).toBe(false);
    await board.openPages();
    await expect(active).toBeHidden();
  });
});
