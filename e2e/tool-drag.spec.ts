import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Перетаскивание кнопки инструмента на холст мышью. */
async function dragToBoard(page: Page, from: Locator, x: number, y: number): Promise<void> {
  const b = (await from.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2, { steps: 2 });
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
}

test.describe('перетаскивание инструментов на холст', () => {
  test('кнопка группы «Фигуры» ставит фигуру', async ({ board, page }) => {
    await dragToBoard(page, page.locator('#btn-shapes'), 700, 400);
    const els = await board.elements();
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: 'shape', shape: 'rect' });
    expect((await board.state()).selection).toEqual([els[0].id]);
    // панель группы при переносе закрывается, а не остаётся висеть
    await expect(page.locator('#ctx-layer .ctx-panel')).toHaveCount(0);
  });

  test('кнопка группы «Стереометрия» ставит тело', async ({ board, page }) => {
    await dragToBoard(page, page.locator('#btn-solids'), 700, 400);
    const els = await board.elements();
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: 'solid', solid: 'cube' });
    expect((await board.state()).selection).toEqual([els[0].id]);
  });

  test('стикер ставится из своей кнопки', async ({ board, page }) => {
    await dragToBoard(page, page.locator('#toolbar [data-tool="note"]'), 760, 420);
    const els = await board.elements();
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: 'note', color: (await board.state()).noteColor });
    expect((await board.state()).selection).toEqual([els[0].id]);
  });

  test('конкретный инструмент ставится из открытой панели группы', async ({ board, page }) => {
    await page.locator('#btn-shapes').click();
    const tool = page.locator('#ctx-layer .ctx-panel [data-shape="triangle"]');
    await expect(tool).toBeVisible();
    await dragToBoard(page, tool, 680, 420);
    const els = await board.elements();
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: 'shape', shape: 'triangle' });
    await expect(page.locator('#ctx-layer .ctx-panel')).toHaveCount(0);
  });
});
