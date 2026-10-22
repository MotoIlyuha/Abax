import type { Page } from '@playwright/test';
import { byTip, expect, test } from './fixtures';

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

test.describe('панель цвета и толщины', () => {
  test('цвет из палитры становится текущим и сохраняется', async ({ board, page }) => {
    await page.locator('#btn-style').click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    await expect(panel).toBeVisible();
    await expect(page.locator('#btn-style')).toHaveClass(/active/);
    await panel.locator('.ctx-swatches:not(.custom) .ctx-swatch[data-c="#ff6464"]').click();
    expect((await board.state()).style.color).toBe('#ff6464');
    await expect(panel.locator('.ctx-swatch[data-c="#ff6464"]').first()).toHaveClass(/active/);
    await board.drag([{ x: 400, y: 300 }, { x: 500, y: 300 }]);
    expect((await board.elements())[0].color).toBe('#ff6464');

    await page.reload();
    await board.ready();
    expect((await board.state()).style.color).toBe('#ff6464');
  });

  test('пресеты: три у пера и маркера, один у остальных', async ({ board, page }) => {
    const presets = page.locator('#toolbar .style-btn');
    await expect(presets.locator('visible=true')).toHaveCount(3);
    // клик по другому пресету выбирает его, повторный — открывает панель
    await presets.nth(1).click();
    await expect(presets.nth(1)).toHaveClass(/current/);
    await expect(page.locator('.ctx-panel[data-kind="style"]')).toHaveCount(0);
    await presets.nth(1).click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    await expect(panel).toBeVisible();
    await panel.locator('.ctx-swatches:not(.custom) .ctx-swatch[data-c="#2dc75c"]').click();
    await board.drag([{ x: 400, y: 300 }, { x: 500, y: 300 }]);
    expect((await board.elements())[0].color).toBe('#2dc75c');

    await board.tool('m');
    await expect(presets.locator('visible=true')).toHaveCount(3);
    expect((await board.state()).style.color).toBe('#ffdc4a');
    await board.tool('r');
    await expect(presets.locator('visible=true')).toHaveCount(1);
    await board.tool('p');
    expect((await board.state()).style.color).toBe('#2dc75c');

    await page.reload();
    await board.ready();
    expect((await board.state()).style.color).toBe('#2dc75c');
  });

  test('слайдер толщины', async ({ board, page }) => {
    await page.locator('#btn-style').click();
    // панель выплывает: меряем после анимации появления
    await board.settled();
    const track = page.locator('.ctx-panel[data-kind="style"] .qs-track');
    const box = (await track.boundingBox())!;
    await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
    expect((await board.state()).style.width).toBeGreaterThan(13);
    await page.mouse.click(box.x + 1, box.y + box.height / 2);
    expect((await board.state()).style.width).toBeLessThan(1.5);
  });

  test('цвет и толщина применяются к выделенному через быстрое меню', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await board.tool('v');
    await board.click({ x: 450, y: 350 });
    await board.quickMenu.locator('[data-ctx="style"]').click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    await expect(panel).toBeVisible();
    await panel.locator('.ctx-swatches:not(.custom) .ctx-swatch[data-c="#2dc75c"]').click();
    expect((await board.elements())[0].color).toBe('#2dc75c');
    const track = panel.locator('.qs-track');
    await board.settled();
    const box = (await track.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect((await board.elements())[0].width).toBeGreaterThan(5);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect((await board.elements())[0]).toMatchObject({ color: '#1f2329', width: 4 * 1.3 });
  });

  test('у текста в быстром меню только цвет, без толщины', async ({ board, page }) => {
    await board.tool('t');
    await board.click({ x: 400, y: 300 });
    await page.keyboard.type('x');
    await page.keyboard.press('Enter');
    await board.tool('v');
    await board.click({ x: 405, y: 312 });
    await expect(byTip(board.quickMenu, 'Цвет')).toBeVisible();
    await board.quickMenu.locator('[data-ctx="style"]').click();
    await expect(page.locator('.ctx-panel[data-kind="style"] .qs-track')).toHaveCount(0);
  });

  test('свой цвет: пикер, hex и «Мои цвета»', async ({ board, page }) => {
    await page.locator('#btn-style').click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    await panel.locator('.ctx-add-color').click();
    await expect(panel.locator('.ctx-add-color')).toHaveText('Готово');
    const hex = panel.locator('.picker-hex input');
    await hex.fill('#123abc');
    await hex.press('Enter');
    expect((await board.state()).style.color).toBe('#123abc');
    await expect(panel.locator('.ctx-swatches.custom .ctx-swatch[data-c="#123abc"]')).toBeVisible();
    // движение по SV-квадрату правит тот же свотч, а не плодит новые
    const sv = (await panel.locator('.picker-sv').boundingBox())!;
    await page.mouse.move(sv.x + sv.width * 0.8, sv.y + sv.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(sv.x + sv.width * 0.9, sv.y + sv.height * 0.1, { steps: 5 });
    await page.mouse.up();
    await expect(panel.locator('.ctx-swatches.custom .ctx-swatch')).toHaveCount(1);
    const picked = (await board.state()).style.color;
    expect(picked).not.toBe('#123abc');
    // полоса оттенка
    await panel.locator('.picker-hue').fill('120');
    expect((await board.state()).style.color).not.toBe(picked);
    await panel.locator('.ctx-add-color').click();
    await expect(panel.locator('.ctx-picker')).toBeHidden();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('doska.customColors') || '[]'));
    expect(saved).toHaveLength(1);
  });

  test('панель закрывается кликом мимо и Esc, повторным кликом по кнопке', async ({ page }) => {
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    await page.locator('#btn-style').click();
    await expect(panel).toBeVisible();
    await page.locator('#btn-style').click();
    await expect(panel).toHaveCount(0);
    await page.locator('#btn-style').click();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await page.locator('#btn-style').click();
    await page.mouse.click(900, 500);
    await expect(panel).toHaveCount(0);
  });

  test('откреплённая панель остаётся на доске, возвращается кнопкой-булавкой', async ({ board, page }) => {
    await page.locator('#btn-shapes').click();
    const panel = page.locator('.ctx-panel[data-kind="shapes"]');
    const grip = panel.locator('.ctx-grip');
    await board.settled();
    const g = (await grip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + 400, g.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(panel).toHaveClass(/detached/);

    // как палитра: выбор инструмента её не закрывает, клик по холсту — тоже
    await panel.locator('[data-shape="ellipse"]').click();
    expect((await board.state()).tool).toBe('ellipse');
    await expect(panel.locator('[data-shape="ellipse"]')).toHaveClass(/active/);
    await board.drag([{ x: 900, y: 600 }, { x: 1000, y: 650 }]);
    await expect(panel).toBeVisible();

    // рядом можно открыть пристыкованную панель другого вида
    await page.locator('#btn-style').click();
    await expect(page.locator('#ctx-layer .ctx-panel')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('#ctx-layer .ctx-panel')).toHaveCount(1);

    await panel.locator('.ctx-pin').click();
    await expect(panel).not.toHaveClass(/detached/);
    await page.locator('#btn-shapes').click();
    await page.locator('#btn-shapes').click();
    const p2 = page.locator('.ctx-panel[data-kind="shapes"]');
    await p2.locator('.ctx-grip').hover();
    await board.settled();
    const g2 = (await p2.locator('.ctx-grip').boundingBox())!;
    await page.mouse.down();
    await page.mouse.move(g2.x + 300, g2.y + 100, { steps: 5 });
    await page.mouse.up();
    await p2.locator('.ctx-close').click();
    await expect(page.locator('#ctx-layer .ctx-panel')).toHaveCount(0);
  });
});

test.describe('настройки доски', () => {
  test('позиция панели инструментов сохраняется', async ({ board, page }) => {
    await page.locator('#btn-settings').click();
    const pop = page.locator('#settings-popover');
    await expect(pop).toBeVisible();
    for (const [name, pos] of [['Сверху', 'top'], ['Справа', 'right'], ['Снизу', 'bottom']]) {
      await pop.locator('button', { hasText: name }).click();
      await expect(page.locator('#toolbar')).toHaveAttribute('data-pos', pos);
      await expect(pop.locator('button', { hasText: name })).toHaveClass(/active/);
    }
    await page.locator('#btn-settings').click();
    await expect(pop).toBeHidden();
    await page.reload();
    await board.ready();
    await expect(page.locator('#toolbar')).toHaveAttribute('data-pos', 'bottom');
  });

  test('панель группы встаёт у кнопки при любой позиции тулбара', async ({ board, page }) => {
    await page.locator('#btn-settings').click();
    for (const name of ['Сверху', 'Справа', 'Снизу', 'Слева']) {
      await page.locator('#settings-popover button', { hasText: name }).click();
      await page.keyboard.press('Escape');
      await page.locator('#btn-solids').click();
      const panel = page.locator('.ctx-panel[data-kind="shapes"]');
      await expect(panel).toBeVisible();
      await board.settled();
      const pb = (await panel.boundingBox())!;
      const wrap = (await page.locator('#canvas-wrap').boundingBox())!;
      expect(pb.x).toBeGreaterThanOrEqual(wrap.x);
      expect(pb.y).toBeGreaterThanOrEqual(wrap.y);
      expect(pb.x + pb.width).toBeLessThanOrEqual(wrap.x + wrap.width);
      expect(pb.y + pb.height).toBeLessThanOrEqual(wrap.y + wrap.height);
      await page.locator('#btn-solids').click();
      await page.locator('#btn-settings').click();
    }
  });

  test('подписи координатной плоскости', async ({ board, page }) => {
    await page.locator('#btn-settings').click();
    const cb = page.locator('#settings-popover label', { hasText: 'Деления' }).locator('input');
    await expect(cb).toBeChecked();
    await cb.uncheck();
    expect((await board.state()).settings.coordLabels).toBe(false);
    await page.reload();
    await board.ready();
    expect((await board.state()).settings.coordLabels).toBe(false);
  });

  test('ось Y координатной плоскости направлена вверх', async ({ board, page }) => {
    // перехватываем подписи на холсте: текст и экранная позиция
    await page.evaluate(() => {
      const calls: { t: string; x: number; y: number }[] = [];
      (window as any).__labels = calls;
      const orig = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (t: string, x: number, y: number, ...rest: any[]) {
        calls.push({ t, x, y });
        return orig.call(this, t, x, y, ...rest);
      };
    });
    await board.grid('coord');
    // начало координат — в середину экрана, чтобы были видны обе полуоси Y
    await page.evaluate(() => {
      const d = (window as any).__doska;
      d.state.camera = { x: -700, y: -400, zoom: 1 };
      d.requestRender();
    });
    await page.waitForTimeout(150);
    const { cam, labels } = await page.evaluate(() => ({
      cam: (window as any).__doska.state.camera,
      labels: (window as any).__labels as { t: string; x: number; y: number }[],
    }));
    const ox = -cam.x * cam.zoom; // экранная x оси Y
    const oy = -cam.y * cam.zoom; // экранная y оси X
    // подписи оси Y — справа выровнены по ox - 5
    const yLabel = (t: string) => labels.find(l => l.t === t && Math.abs(l.x - (ox - 5)) < 1);
    const plus = yLabel('1'), minus = yLabel('-1');
    expect(plus && minus).toBeTruthy();
    expect(plus!.y).toBeLessThan(oy);
    expect(minus!.y).toBeGreaterThan(oy);
  });

  test('панели плавно появляются, анимацию можно выключить', async ({ board, page }) => {
    const anim = (sel: string) => page.locator(sel).evaluate(e => getComputedStyle(e).animationName);
    await page.locator('#btn-style').click();
    expect(await anim('.ctx-panel[data-kind="style"]')).toBe('ui-pop');
    await page.keyboard.press('Escape');
    await page.locator('#btn-settings').click();
    expect(await anim('#settings-popover')).toBe('ui-pop');
    await page.keyboard.press('Control+Comma');
    expect(await anim('#settings-dialog')).toBe('ui-fade');
    expect(await anim('.sd-window')).toBe('ui-pop');
    await page.keyboard.press('Escape');
    // плавающее меню выделения не анимируется
    await board.rect(300, 300, 400, 400);
    await board.tool('v');
    await board.click({ x: 300, y: 350 });
    await expect(board.quickMenu).toBeVisible();
    expect(await anim('#quick-menu')).toBe('none');

    await page.locator('#btn-settings').click();
    const cb = page.locator('#settings-popover label', { hasText: 'Анимация меню и панелей' }).locator('input');
    await expect(cb).toBeChecked();
    await cb.uncheck();
    expect((await board.state()).settings.uiAnimations).toBe(false);
    expect(await anim('#settings-popover')).toBe('none');
    await page.keyboard.press('Escape');
    await page.locator('#btn-style').click();
    expect(await anim('.ctx-panel[data-kind="style"]')).toBe('none');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Comma');
    expect(await anim('.sd-window')).toBe('none');
    await expect(page.locator('.sd-general label', { hasText: 'Анимация меню и панелей' }).locator('input')).not.toBeChecked();
    await page.keyboard.press('Escape');

    await page.reload();
    await board.ready();
    expect((await board.state()).settings.uiAnimations).toBe(false);
    await page.locator('#btn-shapes').click();
    expect(await anim('.ctx-panel[data-kind="shapes"]')).toBe('none');
  });

  test('кнопки отмены и повтора можно скрыть', async ({ board, page }) => {
    const seps = page.locator('#topbar > .sep:visible');
    await expect(page.locator('#btn-undo')).toBeVisible();
    await expect(page.locator('#btn-redo')).toBeVisible();
    const sepsBefore = await seps.count();

    await page.locator('#btn-settings').click();
    const cb = page.locator('#settings-popover label', { hasText: 'Скрыть кнопки отмены и повтора' }).locator('input');
    await expect(cb).not.toBeChecked();
    await cb.check();
    expect((await board.state()).settings.hideUndoRedo).toBe(true);
    await expect(page.locator('#btn-undo')).toBeHidden();
    await expect(page.locator('#btn-redo')).toBeHidden();
    // оба разделителя вокруг кнопок уходят вместе с ними
    await expect(seps).toHaveCount(sepsBefore - 2);
    await page.keyboard.press('Escape');

    // отмена с клавиатуры работает и без кнопки
    await board.rect(300, 300, 400, 400);
    expect(await board.elements()).toHaveLength(1);
    await page.keyboard.press('Control+z');
    expect(await board.elements()).toHaveLength(0);

    await page.reload();
    await board.ready();
    await expect(page.locator('#btn-undo')).toBeHidden();
    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-general label', { hasText: 'Скрыть кнопки отмены и повтора' }).locator('input').uncheck();
    await expect(page.locator('#btn-undo')).toBeVisible();
    await expect(seps).toHaveCount(sepsBefore);
  });

  test('битые настройки в localStorage не ломают загрузку', async ({ board, page }) => {
    await page.evaluate(() => {
      localStorage.setItem('doska.settings', '{oops');
      localStorage.setItem('doska.style', JSON.stringify({ color: 'red', width: 'x' }));
      localStorage.setItem('doska.customColors', '"не массив"');
    });
    await page.reload();
    await board.ready();
    const s = await board.state();
    expect(s.settings.toolbarPos).toBe('left');
    expect(s.style.color).toBe('#1f2329');
  });
});

test.describe('страница', () => {
  test('фон страницы', async ({ board, page }) => {
    for (const grid of ['none', 'dots', 'coord', 'square']) {
      await board.grid(grid);
      expect((await board.state()).grid).toBe(grid);
    }
    await board.grid('dots');
    await board.saved();
    await page.reload();
    await board.ready();
    await expect(page.locator('#grid-mode')).toHaveAttribute('data-value', 'dots');
  });

  test('список фонов: иконки и клавиатура', async ({ board, page }) => {
    await page.locator('#grid-mode').click();
    const options = page.locator('#grid-menu .grid-option');
    await expect(options).toHaveCount(4);
    for (const o of await options.all()) await expect(o.locator('svg')).toHaveCount(1);
    await expect(page.locator('#grid-menu [aria-selected="true"]')).toBeFocused();
    // стрелка вниз с «Клетки» — «Координатная плоскость»; хоткеи холста при этом не срабатывают
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('#grid-menu')).toBeHidden();
    expect((await board.state()).grid).toBe('coord');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#grid-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#grid-menu')).toBeHidden();
    await expect(page.locator('#grid-mode')).toBeFocused();
  });

  test('у всех кнопок шапки есть иконки', async ({ board, page }) => {
    const buttons = page.locator('#topbar button.icon');
    expect(await buttons.count()).toBeGreaterThan(0);
    for (const b of await buttons.all()) {
      await expect(b.locator('svg'), (await b.getAttribute('id')) ?? '').toHaveCount(1);
    }
    void board;
  });

  test('на узком экране название проекта не обрезается, пока есть место', async ({ board, page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    const fits = (sel: string) => page.locator(sel).evaluate(e => e.scrollWidth <= e.clientWidth + 1);
    await expect.poll(() => fits('#project-name')).toBe(true);
    // поле названия страницы — по ширине текста, а не фиксированные 240px
    const pageW = await page.locator('#page-name').evaluate(e => e.getBoundingClientRect().width);
    expect(pageW).toBeLessThan(140);
    expect(await page.locator('#topbar').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    void board;
  });

  test('переименование страницы в шапке', async ({ board, page }) => {
    await page.locator('#page-name').fill('Геометрия');
    await page.locator('#page-name').press('Enter');
    await expect(page.locator('#pages-list .page-name')).toHaveText(['Геометрия']);
    expect((await board.state()).project.pages[0].name).toBe('Геометрия');
  });

  test('сетка рисуется на холсте', async ({ board, page }) => {
    // пиксель на линии клетки отличается от пустого фона
    const pixel = (x: number, y: number) => page.evaluate(([x, y]) => {
      const c = document.getElementById('board') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1).data;
      return [d[0], d[1], d[2]];
    }, [x, y]);
    await board.grid('square');
    await page.waitForTimeout(100);
    const onLine = await pixel(400, 401);
    await board.grid('none');
    await page.waitForTimeout(100);
    const blank = await pixel(400, 401);
    expect(blank).toEqual([255, 255, 255]);
    expect(onLine).not.toEqual(blank);
    void board;
  });

  test('в браузере нет кнопки совместной работы: её сервер есть только в приложении', async ({ board, page }) => {
    await expect(page.locator('#btn-share')).toBeHidden();
    await expect(page.locator('#btn-present')).toBeVisible();
    void board;
  });
});

test.describe('подсказки', () => {
  test('наведение на кнопку показывает подсказку с хоткеем', async ({ page }) => {
    await page.locator('.tool[data-tool="pen"]').hover();
    const tip = page.locator('#tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Перо');
    await expect(tip.locator('.tooltip-kbd')).toHaveText('P');
    await expect(tip).toHaveAttribute('data-side', 'right');
    await page.mouse.move(900, 500);
    await expect(tip).toBeHidden();
  });
});

test.describe('экспорт PNG', () => {
  test('скачивание страницы и выделенного', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    // имя файла берём у ссылки: headless Chromium заменяет кириллицу в имени data:-загрузки на «download»
    await page.evaluate(() => {
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        ((window as any).__downloads ??= []).push(this.download);
        click.call(this);
      };
    });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export').click()]);
    expect(await page.evaluate(() => (window as any).__downloads)).toEqual(['Проект 1 - Страница 1.png']);
    const buf = await (await dl.createReadStream()).toArray();
    const png = Buffer.concat(buf);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    // ширина из заголовка IHDR: фигура 100px + поля, масштаб 2x
    expect(png.readUInt32BE(16)).toBeGreaterThan(200);

    await board.tool('v');
    await board.click({ x: 450, y: 350 });
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+e')]);
    expect(Buffer.concat(await (await dl2.createReadStream()).toArray()).subarray(1, 4).toString()).toBe('PNG');
    expect(await page.evaluate(() => (window as any).__downloads)).toHaveLength(2);
  });

  test('пустая страница — предупреждение', async ({ page }) => {
    const msg = new Promise<string>(resolve => page.once('dialog', d => { resolve(d.message()); void d.dismiss(); }));
    await page.locator('#btn-export').click();
    expect(await msg).toBe('Страница пуста — нечего экспортировать');
  });
});

test.describe('изображения', () => {
  test('вставка кнопкой через выбор файла', async ({ board, page }) => {
    const png = await makePng(page, 400, 200);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-image').click()]);
    await chooser.setFiles({ name: 'graph.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => board.count('image')).toBe(1);
    const [img] = await board.elements();
    expect(img).toMatchObject({ type: 'image', w: 400, h: 200 });
    expect(img.src).toMatch(/^data:image\/png;base64,/);
    expect((await board.state()).selection).toEqual([img.id]);
  });

  test('вставка из буфера обмена и перетаскиванием файла', async ({ board, page }) => {
    const b64 = (await makePng(page, 60, 40)).toString('base64');
    await page.evaluate(b64 => {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const file = new File([bin], 'clip.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      const dt2 = new DataTransfer();
      dt2.items.add(file);
      const wrap = document.getElementById('canvas-wrap')!;
      wrap.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt2, bubbles: true, cancelable: true }));
      wrap.dispatchEvent(new DragEvent('drop', { dataTransfer: dt2, bubbles: true, cancelable: true }));
    }, b64);
    await expect.poll(() => board.count('image')).toBe(2);
    expect((await board.elements())[0]).toMatchObject({ w: 60, h: 40 });
  });

  test('картинку можно масштабировать и вращать ручками', async ({ board, page }) => {
    const png = await makePng(page, 200, 100);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-image').click()]);
    await chooser.setFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => board.count('image')).toBe(1);
    await board.tool('v');
    const img = (await board.elements())[0];
    await board.drag([{ x: img.x + img.w, y: img.y + img.h }, { x: img.x + img.w + 100, y: img.y + img.h + 50 }]);
    const img2 = (await board.elements())[0];
    expect(img2.w).toBeCloseTo(300, 0);
    expect(img2.h).toBeCloseTo(150, 0);
    const cx = img2.x + img2.w / 2, cy = img2.y + img2.h / 2;
    await board.drag([{ x: cx, y: img2.y - 30 }, { x: cx + 100, y: cy - 60 }, { x: cx + 200, y: cy }], { steps: 10 });
    expect((await board.elements())[0].rot).toBeCloseTo(Math.PI / 2, 2);
  });

  test('битый файл — сообщение об ошибке', async ({ board, page }) => {
    const msg = new Promise<string>(resolve => page.once('dialog', d => { resolve(d.message()); void d.dismiss(); }));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-image').click()]);
    await chooser.setFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    expect(await msg).toBe('Не удалось прочитать изображение');
    expect(await board.count()).toBe(0);
  });
});

test.describe('импорт PDF', () => {
  test('каждая страница PDF становится картинкой на доске', async ({ board, page, browser }) => {
    const gen = await browser.newPage();
    await gen.setContent('<h1 style="page-break-after:always">Задача 1</h1><h1>Задача 2</h1>');
    const pdf = await gen.pdf({ format: 'A5' });
    await gen.close();

    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-import').click()]);
    await chooser.setFiles({ name: 'homework.pdf', mimeType: 'application/pdf', buffer: pdf });
    await expect.poll(() => board.count('image'), { timeout: 15_000 }).toBe(2);
    const [p1, p2] = await board.elements();
    expect(p1).toMatchObject({ w: 900 });
    expect(p1.src).toMatch(/^data:image\/jpeg/);
    expect(p2.y).toBeGreaterThan(p1.y + p1.h); // страницы друг под другом
    await page.keyboard.press('Control+z');
    expect(await board.count()).toBe(0); // весь импорт — один шаг истории
  });

  test('битый PDF — сообщение об ошибке', async ({ board, page }) => {
    const msg = new Promise<string>(resolve => page.once('dialog', d => { resolve(d.message()); void d.dismiss(); }));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-import').click()]);
    await chooser.setFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-broken') });
    expect(await msg).toMatch(/^Не удалось открыть PDF/);
    expect(await board.count()).toBe(0);
  });
});
