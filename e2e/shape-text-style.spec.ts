import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** PNG заданного размера, нарисованный самим браузером. */
async function makePng(page: Page, w: number, h: number): Promise<Buffer> {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d')!;
    x.fillStyle = '#3366ff';
    x.fillRect(0, 0, w, h);
    return c.toDataURL('image/png').split(',')[1];
  }, [w, h]);
  return Buffer.from(b64, 'base64');
}

test.describe('масштаб в шапке', () => {
  test('клик по подписи — ввод точного значения с проверкой', async ({ board, page }) => {
    const label = page.locator('#zoom-label');
    const input = page.locator('#zoom-input');
    const hint = page.locator('.zoom-hint');
    await label.click();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('100');
    await expect(label).toBeHidden();

    await input.fill('abc');
    await expect(input).toHaveClass(/invalid/);
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(hint).toHaveText('Введите число, например 150');
    // с ошибкой Enter не применяет и поле не закрывает
    await input.press('Enter');
    await expect(input).toBeVisible();
    expect((await board.state()).camera.zoom).toBe(1);

    await input.fill('4');
    await expect(hint).toHaveText('Масштаб — от 5 до 3200%');
    await input.fill('250 %');
    await expect(hint).toBeHidden();
    await expect(input).not.toHaveClass(/invalid/);
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(label).toHaveText('250%');
    expect((await board.state()).camera.zoom).toBe(2.5);

    // Esc — отмена; уход из поля с ошибкой — тоже без изменений
    await label.click();
    await input.fill('80');
    await input.press('Escape');
    await expect(label).toHaveText('250%');
    await label.click();
    await input.fill('99999');
    await page.locator('#topbar').click({ position: { x: 400, y: 20 } });
    await expect(input).toHaveCount(0);
    expect((await board.state()).camera.zoom).toBe(2.5);

    // дробное — через запятую; масштаб — вокруг центра холста
    const before = await board.state();
    const box = (await board.canvas.boundingBox())!;
    const cx = before.camera.x + box.width / 2 / before.camera.zoom;
    await label.click();
    await input.fill('87,5');
    await input.press('Enter');
    const after = (await board.state()).camera;
    expect(after.zoom).toBe(0.875);
    expect(after.x + box.width / 2 / after.zoom).toBeCloseTo(cx, 5);
  });
});

test.describe('надпись в фигуре', () => {
  test('нарисованная фигура выделена, курсор стоит — набранное уходит в надпись', async ({ board, page }) => {
    const r = await board.rect(400, 300, 600, 400);
    let st = await board.state();
    expect(st.tool).toBe('select');
    expect(st.selection).toEqual([r.id]);
    await expect(page.locator('.shape-caret')).toBeVisible();

    // буква — не горячая клавиша (V, P…), а начало надписи
    await page.keyboard.type('Vp 1');
    const editor = page.locator('#overlay textarea.inplace-edit.shape');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('Vp 1');
    await expect(page.locator('.shape-caret')).toHaveCount(0);
    expect((await board.state()).tool).toBe('select');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('x');
    await page.keyboard.press('Enter');
    await expect(editor).toHaveCount(0);
    expect((await board.elements())[0].text).toBe('Vp 1\nx');
    // после ввода фигура по-прежнему выделена и курсор снова стоит
    st = await board.state();
    expect(st.selection).toEqual([r.id]);
    await expect(page.locator('.shape-caret')).toBeVisible();

    // Enter — дописать; Esc в редакторе — «готово», текст остаётся
    await page.keyboard.press('Enter');
    await expect(editor).toHaveValue('Vp 1\nx');
    await page.keyboard.type('y');
    await page.keyboard.press('Escape');
    expect((await board.elements())[0].text).toBe('Vp 1\nxy');
    // второй Esc снимает выделение — горячие клавиши снова работают
    await page.keyboard.press('Escape');
    expect((await board.state()).selection).toEqual([]);
    await expect(page.locator('.shape-caret')).toHaveCount(0);
    await page.keyboard.press('p');
    expect((await board.state()).tool).toBe('pen');

    await page.keyboard.press('Control+z');
    expect((await board.elements())[0].text).toBe('Vp 1\nx');
  });

  test('эллипс и треугольник — с надписью, у линии курсора нет', async ({ board, page }) => {
    for (const [key, shape] of [['o', 'ellipse'], ['y', 'triangle']] as const) {
      await board.tool(key);
      await board.drag([{ x: 300, y: 300 }, { x: 500, y: 450 }]);
      await page.keyboard.type('ab');
      await page.keyboard.press('Enter');
      const els = await board.elements();
      expect(els[els.length - 1]).toMatchObject({ shape, text: 'ab' });
      await page.keyboard.press('Escape');
    }
    await board.tool('l');
    await board.drag([{ x: 300, y: 600 }, { x: 500, y: 650 }]);
    const els = await board.elements();
    expect((await board.state()).selection).toEqual([els[els.length - 1].id]);
    await expect(page.locator('.shape-caret')).toHaveCount(0);
    await page.keyboard.press('p');
    expect((await board.state()).tool).toBe('pen');
  });

  test('двойной клик открывает надпись; стёртая надпись убирается, фигура остаётся', async ({ board, page }) => {
    await board.rect(400, 300, 600, 400);
    await page.keyboard.type('abc');
    await board.click({ x: 800, y: 600 }); // клик мимо фиксирует ввод и снимает выделение
    expect((await board.elements())[0].text).toBe('abc');
    expect((await board.state()).selection).toEqual([]);

    await board.dblclick({ x: 450, y: 320 });
    const editor = page.locator('#overlay textarea.inplace-edit.shape');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('abc');
    await editor.fill('');
    await page.keyboard.press('Enter');
    const [r] = await board.elements();
    expect(r).toMatchObject({ type: 'shape', shape: 'rect' });
    expect(r).not.toHaveProperty('text');
  });

  test('Delete удаляет выделенную фигуру, хотя в ней стоит курсор', async ({ board, page }) => {
    await board.rect(400, 300, 600, 400);
    await expect(page.locator('.shape-caret')).toBeVisible();
    await page.keyboard.press('Delete');
    expect(await board.count()).toBe(0);
  });

  test('перенос фигуры не теряет только что набранную надпись', async ({ board, page }) => {
    await board.rect(400, 300, 600, 400);
    await page.keyboard.type('abc');
    await board.drag([{ x: 410, y: 310 }, { x: 510, y: 410 }]);
    expect((await board.elements())[0]).toMatchObject({ x: 500, y: 400, text: 'abc' });
  });
});

test.describe('прозрачность и скругление', () => {
  test('ползунок прозрачности — между толщиной и цветами; новые элементы его наследуют', async ({ board, page }) => {
    await page.locator('#btn-style').click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    await board.settled();
    const order = await panel.evaluate(p => [...p.children].map(c => c.className));
    expect(order.slice(0, 3)).toEqual(['ctx-range ctx-width', 'ctx-range ctx-opacity', 'ctx-scroll']);
    // у толщины — иконка слева и значение справа
    await expect(panel.locator('.ctx-width .ctx-range-icon svg')).toBeVisible();
    await expect(panel.locator('.ctx-width .ctx-range-val')).toHaveText('4');
    const track = panel.locator('.ctx-opacity .ctx-range-track');
    await expect(track).toHaveAttribute('aria-valuetext', '100%');
    const box = (await track.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const opacity = (await board.state()).style.opacity as number;
    expect(opacity).toBeGreaterThan(0.45);
    expect(opacity).toBeLessThan(0.65);
    await expect(panel.locator('.ctx-opacity .ctx-range-val')).toHaveText(`${Math.round(opacity * 100)}%`);
    // клавиатура: стрелки — по 1%
    await track.press('ArrowRight');
    expect((await board.state()).style.opacity).toBeCloseTo(opacity + 0.01, 5);
    await page.keyboard.press('Escape');
    await board.drag([{ x: 400, y: 300 }, { x: 500, y: 300 }]);
    expect((await board.elements())[0].opacity).toBeCloseTo(opacity + 0.01, 5);
    // радиуса у пера нет — он только в меню выделения прямоугольников и картинок
    await page.locator('#btn-style').click();
    await expect(panel.locator('.ctx-radius')).toHaveCount(0);

    await page.reload();
    await board.ready();
    expect((await board.state()).style.opacity).toBeCloseTo(opacity + 0.01, 5);
  });

  test('скругление прямоугольника: ползунок с иконкой уголка, один шаг истории на протягивание', async ({ board, page }) => {
    await board.rect(400, 300, 600, 400);
    await board.quickMenu.locator('[data-ctx="style"]').click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    await board.settled();
    const icon = panel.locator('.ctx-radius .ctx-range-icon path');
    await expect(icon).toHaveAttribute('d', 'M5 19V5.00H19');
    const track = panel.locator('.ctx-radius .ctx-range-track');
    const box = (await track.boundingBox())!;
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    const radius = (await board.elements())[0].radius;
    expect(radius).toBeGreaterThan(20);
    expect(radius).toBeLessThan(30);
    await expect(panel.locator('.ctx-radius .ctx-range-val')).toHaveText(String(radius));
    // уголок скруглился
    await expect(icon).toHaveAttribute('d', /A/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    expect((await board.elements())[0]).not.toHaveProperty('radius');

    // у эллипса скругления нет
    await page.keyboard.press('Escape');
    await board.tool('o');
    await board.drag([{ x: 700, y: 300 }, { x: 800, y: 400 }]);
    await board.quickMenu.locator('[data-ctx="style"]').click();
    await expect(panel.locator('.ctx-opacity')).toBeVisible();
    await expect(panel.locator('.ctx-radius')).toHaveCount(0);
  });

  test('рамка картинки: цвет, толщина, прозрачность и скругление', async ({ board, page }) => {
    const png = await makePng(page, 300, 200);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-image').click()]);
    await chooser.setFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => board.count('image')).toBe(1);
    // вставленная картинка выделена, текстового курсора у неё нет
    expect((await board.state()).selection).toHaveLength(1);
    await expect(page.locator('.shape-caret')).toHaveCount(0);

    await board.quickMenu.locator('[data-ctx="style"]').click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    await expect(panel.locator('.qs-track')).toBeVisible();
    await expect(panel.locator('.ctx-opacity')).toBeVisible();
    await expect(panel.locator('.ctx-radius')).toBeVisible();
    const off = panel.locator('.ctx-frame-off');
    await expect(off).toBeHidden();

    await panel.locator('.ctx-swatches:not(.custom) .ctx-swatch[data-c="#ff6464"]').click();
    const width = (await board.state()).style.width;
    expect((await board.elements())[0]).toMatchObject({ color: '#ff6464', width });
    await expect(off).toBeVisible();

    await board.settled();
    const drop = (await panel.locator('.qs-track').boundingBox())!;
    await page.mouse.click(drop.x + drop.width - 1, drop.y + drop.height / 2);
    expect((await board.elements())[0].width).toBeGreaterThan(13);
    const op = (await panel.locator('.ctx-opacity .ctx-range-track').boundingBox())!;
    await page.mouse.click(op.x + op.width / 2, op.y + op.height / 2);
    expect((await board.elements())[0].opacity).toBeLessThan(0.7);
    await panel.locator('.ctx-radius .ctx-range-track').press('End');
    expect((await board.elements())[0].radius).toBe(50);

    await off.click();
    const img = (await board.elements())[0];
    expect(img).not.toHaveProperty('color');
    expect(img).not.toHaveProperty('width');
    expect(img).not.toHaveProperty('opacity');
    expect(img.radius).toBe(50); // скругление — не рамка, остаётся
    await expect(off).toBeHidden();
    await page.keyboard.press('Control+z');
    expect((await board.elements())[0]).toMatchObject({ color: '#ff6464', radius: 50 });
  });
});

test.describe('панель инструментов', () => {
  test('заголовок группы инструментов мышью не выделяется', async ({ page }) => {
    await page.locator('#btn-shapes').click();
    const title = page.locator('.ctx-panel .ctx-title');
    await expect(title).toHaveText('Фигуры');
    await title.click({ clickCount: 3 });
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    await expect(title).toHaveCSS('user-select', 'none');
  });
});
