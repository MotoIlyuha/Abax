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

  test('липкий стикер ставится из своей кнопки', async ({ board, page }) => {
    await dragToBoard(page, page.locator('#toolbar [data-tool="stikyNote"]'), 760, 420);
    const els = await board.elements();
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: 'stikyNote', color: (await board.state()).stikyNoteColor });
    expect((await board.state()).selection).toEqual([]);
  });

  test('стопка отдаёт лист своего цвета, а превью совпадает с размещением при другом масштабе', async ({ board, page }) => {
    await page.locator('#zoom-in').click();
    await board.settleCamera();
    await board.tool('n');
    const panel = page.locator('.ctx-panel[data-kind="stikyNote"]');
    await expect(panel).toContainText('Липкие стикеры');
    await expect(panel.locator('.stiky-note-stack')).toHaveCount(8);
    const stack = panel.getByRole('button', { name: 'Сиреневый' });
    await expect(stack).not.toHaveAttribute('aria-pressed');
    await stack.evaluate(el => el.addEventListener('animationstart', e => {
      if (e instanceof AnimationEvent) el.dataset.animations = `${el.dataset.animations ?? ''} ${e.animationName}`;
    }));
    const from = (await stack.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(760, 420);
    await expect(stack).toHaveAttribute('data-animations', /stiky-note-peel/);
    await expect(stack).toHaveAttribute('data-animations', /stiky-note-fold/);

    const ghost = page.locator('.stiky-note-ghost');
    expect(await ghost.evaluate(el => getComputedStyle(el, '::before').backgroundColor)).toBe('rgb(228, 193, 249)');
    await expect(ghost).toHaveCSS('opacity', '0.65');
    const preview = (await ghost.boundingBox())!;
    expect(await board.count()).toBe(0);
    await page.mouse.up();
    await expect(ghost).toHaveCount(0);
    const [note] = await board.elements();
    const { camera } = await board.state();
    const placed = await board.screen({ x: note.x, y: note.y });
    expect(note).toMatchObject({ type: 'stikyNote', color: '#e4c1f9', text: '' });
    expect(camera.zoom).toBeGreaterThan(1);
    expect(preview.width).toBeCloseTo(note.w * camera.zoom, 1);
    expect(preview.height).toBeCloseTo(note.h * camera.zoom, 1);
    expect(preview.x).toBeCloseTo(placed.x, 1);
    expect(preview.y).toBeCloseTo(placed.y, 1);
    await page.locator('textarea.inplace-edit.stikyNote').press('Enter');
    expect(await board.elements()).toEqual([note]);
  });

  test('с обычными анимациями лист перетаскивается без отрыва и остаётся в стопке при отмене', async ({ board, page }) => {
    await page.evaluate(() => localStorage.setItem('doska.settings', JSON.stringify({ animationMode: 'normal' })));
    await page.reload();
    await board.ready();
    await board.tool('n');
    const stack = page.getByRole('button', { name: 'Голубой' });
    await expect(stack).toBeVisible();
    const from = (await stack.boundingBox())!;
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(760, 420);
    const ghost = page.locator('.stiky-note-ghost');
    await expect(ghost).toBeVisible();
    await expect(stack.locator('.stiky-note-sheet--top')).toHaveCSS('animation-name', 'none');
    await page.mouse.move(x, y);
    await page.mouse.up();
    await expect(ghost).toHaveCount(0);
    await expect(stack).not.toHaveAttribute('aria-pressed');
    expect(await board.count()).toBe(0);
  });

  test('конкретный инструмент ставится из открытой панели группы', async ({ board, page }) => {
    await page.locator('#btn-shapes').click();
    const tool = page.locator('#ctx-layer .ctx-panel [data-shape="triangle"]');
    await expect(tool).toBeVisible();
    // панель вытягивается из кнопки: берём кнопку, когда она встала на место
    await expect.poll(() => page.locator('#ctx-layer .ctx-panel').evaluate(el => (el as HTMLElement).style.transform)).toBe('');
    await dragToBoard(page, tool, 680, 420);
    const els = await board.elements();
    expect(els).toHaveLength(1);
    expect(els[0]).toMatchObject({ type: 'shape', shape: 'triangle' });
    await expect(page.locator('#ctx-layer .ctx-panel')).toHaveCount(0);
  });
});
