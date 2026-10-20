import type { Page } from '@playwright/test';
import { expect, test, type Board } from './fixtures';

type Pt = { x: number; y: number };

async function openPresent(page: Page): Promise<Page> {
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#btn-present').click()]);
  await expect(page.locator('#btn-present')).toHaveClass(/active/);
  await expect.poll(() => popup.evaluate(() => document.querySelector('canvas')?.width ?? 0)).toBeGreaterThan(0);
  return popup;
}

/** Сколько пикселей холста окна демонстрации близки к цвету hex (в прямоугольнике css-координат). */
function countColor(popup: Page, hex: string, box?: { x0: number; y0: number; x1: number; y1: number }): Promise<number> {
  return popup.evaluate(([hex, box]) => {
    const c = document.querySelector('canvas')!;
    const k = c.width / innerWidth;
    const b = box ?? { x0: 0, y0: 0, x1: innerWidth, y1: innerHeight };
    const x0 = Math.max(0, Math.floor(b.x0 * k)), y0 = Math.max(0, Math.floor(b.y0 * k));
    const w = Math.min(c.width, Math.ceil(b.x1 * k)) - x0, h = Math.min(c.height, Math.ceil(b.y1 * k)) - y0;
    const d = c.getContext('2d')!.getImageData(x0, y0, w, h).data;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), bl = parseInt(hex.slice(5, 7), 16);
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - r) < 24 && Math.abs(d[i + 1] - g) < 24 && Math.abs(d[i + 2] - bl) < 24) n++;
    }
    return n;
  }, [hex, box] as const);
}

/** То же на основном холсте. */
function countMain(page: Page, hex: string): Promise<number> {
  return page.evaluate(hex => {
    const c = document.getElementById('board') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - r) < 24 && Math.abs(d[i + 1] - g) < 24 && Math.abs(d[i + 2] - b) < 24) n++;
    }
    return n;
  }, hex);
}

/** Точка сцены → css-координаты окна демонстрации (видимая область основного холста по центру). */
async function toPresent(board: Board, popup: Page, p: Pt): Promise<Pt> {
  const box = (await board.canvas.boundingBox())!;
  const cam = (await board.state()).camera;
  const [w, h] = await popup.evaluate(() => [innerWidth, innerHeight]);
  const zoom = cam.zoom * Math.min(w / box.width, h / box.height);
  const cx = cam.x + box.width / cam.zoom / 2 - w / zoom / 2;
  const cy = cam.y + box.height / cam.zoom / 2 - h / zoom / 2;
  return { x: (p.x - cx) * zoom, y: (p.y - cy) * zoom };
}

const around = (p: Pt, r: number) => ({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });

test.describe('окно демонстрации', () => {
  test('показывает только холст и закрывается кнопкой', async ({ page }) => {
    const popup = await openPresent(page);
    expect(await popup.title()).toBe('Доска — демонстрация');
    // ничего, кроме холста: ни тулбара, ни верхней панели
    expect(await popup.evaluate(() => [...document.body.children].map(e => e.tagName))).toEqual(['CANVAS']);
    await page.locator('#btn-present').click();
    await expect(page.locator('#btn-present')).not.toHaveClass(/active/);
    await expect.poll(() => popup.isClosed()).toBe(true);
  });

  test('закрытие окна снимает отметку с кнопки', async ({ page }) => {
    const popup = await openPresent(page);
    await popup.close();
    await expect(page.locator('#btn-present')).not.toHaveClass(/active/);
  });

  test('рисунок появляется сразу, рамки выделения и ручек нет', async ({ board, page }) => {
    const popup = await openPresent(page);
    await board.drag([{ x: 300, y: 300 }, { x: 420, y: 330 }, { x: 520, y: 300 }]);
    const mid = await toPresent(board, popup, { x: 420, y: 330 });
    await expect.poll(() => countColor(popup, '#1f2329', around(mid, 12))).toBeGreaterThan(10);

    await board.rect(600, 200, 760, 320);
    await board.tool('v');
    await board.click({ x: 680, y: 260 });
    expect((await board.state()).selection).toHaveLength(1);
    // в основном окне — синяя рамка и ручки, в окне демонстрации их нет, а сама фигура есть
    await expect.poll(() => countMain(page, '#3273f5')).toBeGreaterThan(50);
    expect(await countColor(popup, '#3273f5')).toBe(0);
    const corner = await toPresent(board, popup, { x: 600, y: 260 });
    expect(await countColor(popup, '#1f2329', around(corner, 6))).toBeGreaterThan(3);
  });

  test('следует за камерой основного окна', async ({ board, page }) => {
    const popup = await openPresent(page);
    await board.rect(400, 300, 500, 400);
    const before = await toPresent(board, popup, { x: 400, y: 350 });
    await expect.poll(() => countColor(popup, '#1f2329', around(before, 5))).toBeGreaterThan(3);
    // панорама пробелом + перетаскивание
    const box = (await board.canvas.boundingBox())!;
    await page.keyboard.down('Space');
    await page.mouse.move(box.x + 700, box.y + 500);
    await page.mouse.down();
    await page.mouse.move(box.x + 500, box.y + 400, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    const after = await toPresent(board, popup, { x: 400, y: 350 });
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(50);
    await expect.poll(() => countColor(popup, '#1f2329', around(after, 5))).toBeGreaterThan(3);
  });

  test('текст виден ещё во время ввода', async ({ board, page }) => {
    const popup = await openPresent(page);
    // цвет — после выбора инструмента: у пера свои пресеты, у текста другой
    await board.tool('t');
    await page.locator('#btn-style').click();
    await page.locator('.ctx-panel[data-kind="style"] .ctx-swatches:not(.custom) .ctx-swatch[data-c="#bd0a0a"]').click();
    await board.click({ x: 400, y: 300 });
    await page.keyboard.type('Пример 2+2');
    expect(await board.count('text')).toBe(0); // ещё не зафиксирован
    const at = await toPresent(board, popup, { x: 440, y: 315 });
    await expect.poll(() => countColor(popup, '#bd0a0a', around(at, 40))).toBeGreaterThan(20);
    await page.keyboard.press('Escape');
    await expect.poll(() => countColor(popup, '#bd0a0a', around(at, 40))).toBe(0);
  });
});
