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

  test('контекстное меню добавляет и убирает цвет из моих цветов', async ({ page }) => {
    await page.locator('#btn-style').click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    const color = '#ff6464';
    await panel.locator(`.ctx-swatches:not(.custom) [data-c="${color}"]`).click({ button: 'right' });
    await page.getByRole('button', { name: 'Добавить в мои цвета' }).click();
    await expect(panel.locator(`.ctx-swatches.custom [data-c="${color}"]`)).toHaveCount(1);
    await panel.locator(`.ctx-swatches.custom [data-c="${color}"]`).click({ button: 'right' });
    await page.getByRole('button', { name: 'Убрать из моих цветов' }).click();
    await expect(panel.locator(`.ctx-swatches.custom [data-c="${color}"]`)).toHaveCount(0);
  });

  test('перетаскивание в «Мои цвета»: приёмник синеет над зоной, текст — только без своих цветов', async ({ page }) => {
    await page.locator('#btn-style').click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    const hint = panel.locator('.ctx-drop-hint');
    await expect(hint).toContainText('Перетащите цвет сюда');
    const src = (await panel.locator('.ctx-swatches:not(.custom) [data-c="#ff6464"]').boundingBox())!;
    const dst = (await hint.boundingBox())!;
    await page.mouse.move(src.x + 17, src.y + 17);
    await page.mouse.down();
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 8 });
    await page.mouse.move(dst.x + dst.width / 2 + 4, dst.y + dst.height / 2);
    await expect(panel.locator('.ctx-my-colors')).toHaveClass(/drop-over/);
    await page.mouse.up();
    await expect(panel.locator('.ctx-swatches.custom [data-c="#ff6464"]')).toHaveCount(1);
    await expect(panel.locator('.ctx-my-colors')).not.toHaveClass(/drop-over/);
    // свои цвета есть — пустой приёмник без текста
    await expect(hint).toHaveText('');
    await expect(hint).toBeVisible();
  });

  test('пипетка в «Добавить цвет»: превью следует за курсором, щелчок добавляет цвет, Esc отменяет', async ({ board, page }) => {
    await page.locator('#btn-style').click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    // цели пипетки — свои блоки в углах окна («Все цвета» при открытом пикере свёрнуты)
    await page.evaluate(() => {
      for (const [side, bg] of [['left', '#2dc75c'], ['right', '#123456']]) {
        const d = document.createElement('div');
        d.style.cssText = `position:fixed;${side}:0;bottom:0;width:40px;height:40px;z-index:9999;background:${bg}`;
        document.body.appendChild(d);
      }
    });
    const { width: vw, height: vh } = page.viewportSize()!;
    await panel.locator('.ctx-add-color').click();
    await expect(panel.locator('.ctx-all-colors')).toBeHidden();
    const hex = panel.locator('.picker-hex input');
    const before = await hex.inputValue();
    // Esc — прежний цвет
    await panel.getByRole('button', { name: 'Пипетка' }).click();
    await page.mouse.move(20, vh - 20);
    await expect(hex).toHaveValue('#2dc75c');
    // лупа с пиксельной сеткой; колесо меняет её размер (пружиной — доезжает до цели)
    const loupe = page.locator('.eyedropper-loupe');
    await expect(loupe).toBeVisible();
    await expect(loupe.locator('.eyedropper-hex')).toHaveText('#2dc75c');
    const w0 = (await loupe.boundingBox())!.width;
    await page.mouse.wheel(0, -200);
    await expect.poll(async () => (await loupe.boundingBox())!.width).toBeGreaterThan(w0 + 30);
    await page.keyboard.press('Escape');
    await expect(page.locator('.eyedropper-overlay')).toHaveCount(0);
    await expect(hex).toHaveValue(before);
    // щелчок по цвету не из палитры — он в «Моих цветах» и текущий
    await panel.getByRole('button', { name: 'Пипетка' }).click();
    await page.mouse.move(vw - 20, vh - 20);
    await expect(hex).toHaveValue('#123456');
    await page.mouse.click(vw - 20, vh - 20);
    await expect(page.locator('.eyedropper-overlay')).toHaveCount(0);
    await expect(panel.locator('.ctx-swatches.custom [data-c="#123456"]')).toHaveCount(1);
    expect((await board.state()).style.color).toBe('#123456');
    await expect(panel.locator('.ctx-drop-hint')).toContainText('Перетащите цвет сюда');
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

  test('у инструментов без цвета выбора цвета на панели нет', async ({ board, page }) => {
    const styleGroup = page.locator('#toolbar .style-group');
    await expect(styleGroup).toBeVisible();
    await page.locator('#btn-style').click();
    await expect(page.locator('.ctx-panel[data-kind="style"]')).toBeVisible();
    for (const key of ['v', 'h', 'e', 'x', 'n']) {
      await board.tool(key);
      await expect(styleGroup).toBeHidden();
      await expect(page.locator('#toolbar .style-sep')).toBeHidden();
    }
    // открытая с панели палитра закрылась вместе с кнопками
    await expect(page.locator('.ctx-panel[data-kind="style"]')).toHaveCount(0);
    // у лазерной указки цвет выбирается, пресет один
    await board.groupTool('pointer', 'laser');
    await expect(styleGroup).toBeVisible();
    await board.groupTool('pointer', 'flash');
    await expect(styleGroup).toBeHidden();
    await board.groupTool('pointer', 'fadePen');
    await expect(styleGroup).toBeVisible();
    for (const key of ['t', 'r', 'p']) {
      await board.tool(key);
      await expect(styleGroup).toBeVisible();
    }
    await expect(page.locator('#toolbar .style-btn').locator('visible=true')).toHaveCount(3);
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

  test('дорожка прозрачности показывает цвет выбранной вкладки', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await board.tool('v');
    await board.click({ x: 450, y: 350 });
    await board.quickMenu.locator('[data-ctx="style"]').click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    await panel.locator('.ctx-swatches:not(.custom) [data-c="#2dc75c"]').click();
    await panel.getByRole('button', { name: 'Заливка' }).click();
    await expect(panel).toHaveCSS('--ink', 'transparent');
    await panel.locator('.ctx-swatches:not(.custom) [data-c="#ff6464"]').click();
    await expect(panel).toHaveCSS('--ink', '#ff6464');
    await panel.getByRole('button', { name: 'Рамка' }).click();
    await expect(panel).toHaveCSS('--ink', '#2dc75c');
  });

  test('у текста в быстром меню только цвет, без толщины', async ({ board, page }) => {
    await board.tool('t');
    await board.click({ x: 400, y: 300 });
    await page.keyboard.type('x');
    await page.keyboard.press('Enter');
    // вставленный текст выделен — меню выделения уже над ним
    await expect(byTip(board.quickMenu, 'Цвет')).toBeVisible();
    await board.quickMenu.locator('[data-ctx="style"]').click();
    await expect(page.locator('.ctx-panel[data-kind="style"] .qs-track')).toHaveCount(0);
  });

  test('свой цвет: пикер, hex и «Мои цвета»', async ({ board, page }) => {
    await page.locator('#btn-style').click();
    const panel = page.locator('.ctx-panel[data-kind="style"]');
    await panel.locator('.ctx-add-color').click();
    await expect(panel.locator('.ctx-add-color')).toHaveText('Готово');
    // пикер вместо «Всех цветов»
    await expect(panel.locator('.ctx-all-colors')).toBeHidden();
    await expect(panel.locator('.ctx-section-action')).toHaveText('Развернуть');
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
    // «Все цвета» возвращаются
    await expect(panel.locator('.ctx-all-colors')).toBeVisible();
    await expect(panel.locator('.ctx-section-action')).toHaveText('Свернуть');
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

  test('клик по группе выбирает показанный инструмент и запоминает выбор', async ({ board, page }) => {
    await page.locator('#btn-shapes').click();
    const panel = page.locator('.ctx-panel[data-kind="shapes"]');
    await expect(panel).toBeVisible();
    expect((await board.state()).tool).toBe('rect');
    await panel.locator('[data-shape="ellipse"]').click();
    await board.tool('p');
    await page.locator('#btn-shapes').click();
    await expect(panel).toBeVisible();
    expect((await board.state()).tool).toBe('ellipse');
    await expect(panel.locator('[data-shape="ellipse"]')).toHaveClass(/active/);
  });

  test('выбор инструмента из группы удержанием и отпусканием', async ({ board, page }) => {
    await page.evaluate(() => {
      (window as unknown as { vibrations: number[] }).vibrations = [];
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (ms: number) => {
        (window as unknown as { vibrations: number[] }).vibrations.push(ms);
        return true;
      } });
    });
    const group = page.locator('#btn-shapes');
    const box = (await group.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const panel = page.locator('.ctx-panel[data-kind="shapes"]');
    await expect(panel).toBeVisible();
    // панель вытягивается из кнопки: кнопки встают на места, когда вытягивание закончилось
    await expect.poll(() => panel.evaluate(el => (el as HTMLElement).style.transform)).toBe('');
    const target = (await panel.locator('[data-shape="ellipse"]').boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
    await expect(panel.locator('[data-shape="ellipse"]')).toHaveClass(/gesture-hover/);
    await expect(page.locator('#tooltip')).toBeVisible();
    await expect(page.locator('#tooltip')).toContainText('Эллипс');
    expect(await page.evaluate(() => (window as unknown as { vibrations: number[] }).vibrations)).toContain(10);
    await page.mouse.up();
    expect((await board.state()).tool).toBe('ellipse');
    await expect(panel).toHaveCount(0);
    await expect(page.locator('#tooltip')).toBeHidden();
    await group.click();
    await expect(panel).toBeVisible();
  });

  test('откреплённая панель остаётся на доске, возвращается кнопкой-булавкой', async ({ board, page }) => {
    await page.locator('#btn-shapes').click();
    const panel = page.locator('.ctx-panel[data-kind="shapes"]');
    const grip = panel.locator('.ctx-grip');
    await board.settled();
    // панель вытягивается из кнопки: ручку берём, когда она встала на место
    await expect.poll(() => panel.evaluate(el => (el as HTMLElement).style.transform)).toBe('');
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

    // рядом можно открыть пристыкованную панель другого вида (эллипс выделен — включено выделение, берём перо)
    await board.tool('p');
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
    await p2.locator('.ctx-pin').click();
    await page.locator('#btn-shapes').click();
    await expect(page.locator('#ctx-layer .ctx-panel')).toHaveCount(0);
  });
});

test.describe('настройки доски', () => {
  test('позиция панели инструментов сохраняется', async ({ board, page }) => {
    await page.locator('#btn-settings').dispatchEvent('click');
    const pop = page.locator('#settings-popover');
    await expect(pop).toBeVisible();
    for (const [name, pos] of [['Сверху', 'top'], ['Справа', 'right'], ['Снизу', 'bottom']]) {
      await pop.locator('button', { hasText: name }).click();
      await expect(page.locator('#toolbar')).toHaveAttribute('data-pos', pos);
      await expect(pop.locator('button', { hasText: name })).toHaveClass(/active/);
    }
    await page.locator('#btn-settings').dispatchEvent('click');
    await expect(pop).toBeHidden();
    await page.reload();
    await board.ready();
    await expect(page.locator('#toolbar')).toHaveAttribute('data-pos', 'bottom');
  });

  test('панель группы встаёт у кнопки при любой позиции тулбара', async ({ board, page }) => {
    await page.locator('#btn-settings').dispatchEvent('click');
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
      await page.locator('#btn-settings').dispatchEvent('click');
    }
  });

  test('подменю «Взаимодействия» в МВВ: привязка, плавное движение, направляющие — переключатели', async ({ board, page }) => {
    await page.locator('#zoom-label').click();
    const menu = page.locator('#view-menu');
    await menu.locator('[data-view="interactions"]').click();
    await expect(menu.locator('.view-back')).toHaveText('Взаимодействия›');
    const switches = menu.locator('.view-switch');
    await expect(switches).toHaveText(['Привязка к сетке', 'Плавное движение', 'Направляющие']);
    for (const sw of await switches.all()) await expect(sw.locator('.view-icon svg')).toHaveCount(1);
    const sw = switches.filter({ hasText: 'Привязка к сетке' });
    const cb = sw.locator('input[role="switch"]');
    await expect(cb).not.toBeChecked();
    await sw.click();
    await expect(cb).toBeChecked();
    // меню не закрывается: можно сразу переключить обратно
    await expect(menu).toBeVisible();
    expect((await board.state()).settings.snapToGrid).toBe(true);
    await switches.filter({ hasText: 'Направляющие' }).click();
    expect((await board.state()).settings.alignGuides).toBe(false);
    // в настройках этих пунктов больше нет
    await page.keyboard.press('Escape');
    // в главном меню Abax пункта нет
    await page.locator('#btn-home').click();
    await expect(page.locator('#main-menu', { hasText: 'Привязка к сетке' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('#btn-settings').dispatchEvent('click');
    for (const text of ['Привязка к сетке', 'Плавное движение', 'Направляющие']) await expect(page.locator('#settings-popover', { hasText: text })).toHaveCount(0);
  });

  test('меню «Скрыть» — переключатели, меню не закрывается', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    await page.locator('#main-menu [data-section="hide"]').click();
    const undo = page.locator('#menu-hide .main-switch', { hasText: 'Кнопки отмены и повтора' });
    const imports = page.locator('#menu-hide .main-switch', { hasText: 'Кнопки импорта' });
    await expect(undo.locator('input[role="switch"]')).not.toBeChecked();
    await undo.click();
    await expect(undo.locator('input')).toBeChecked();
    expect((await board.state()).settings.hideUndoRedo).toBe(true);
    await imports.click();
    await expect(page.locator('.import-group')).toBeHidden();
    await expect(page.locator('#main-menu')).toBeVisible();
    await imports.click();
    await expect(page.locator('.import-group')).toBeVisible();
    // после закрытия и открытия меню состояние то же
    await page.keyboard.press('Escape');
    await page.locator('#btn-home').click();
    await page.locator('#main-menu [data-section="hide"]').click();
    await expect(undo.locator('input')).toBeChecked();
    await expect(imports.locator('input')).not.toBeChecked();
  });

  test('«Скрыть»: при улучшенных анимациях группа уезжает влево и растворяется, без анимаций — сразу', async ({ board, page }) => {
    const undoGroup = page.locator('.undo-group');
    const importGroup = page.locator('.import-group');
    const importX = async () => (await importGroup.boundingBox())!.x;
    const startX = await importX();
    await page.locator('#btn-home').click();
    await page.locator('#main-menu [data-section="hide"]').click();
    await page.locator('#menu-hide .main-switch', { hasText: 'Кнопки отмены и повтора' }).click();
    // в пути: сдвиг влево, прозрачность и место под соседом
    const mid = await undoGroup.evaluate(e => ({ ml: parseFloat(e.style.marginLeft), op: parseFloat(e.style.opacity), z: getComputedStyle(e).zIndex }));
    expect(mid.ml).toBeLessThan(0);
    expect(mid.op).toBeLessThan(1);
    expect(mid.z).toBe('-1');
    await expect(undoGroup).toBeHidden();
    // импорт съехал на место отмены
    expect(await importX()).toBeLessThan(startX - 40);
    await expect(undoGroup).toHaveAttribute('style', '');
    // обратно — выезжает
    await page.locator('#menu-hide .main-switch', { hasText: 'Кнопки отмены и повтора' }).click();
    await expect(undoGroup).toBeVisible();
    await expect.poll(importX).toBeCloseTo(startX, 0);
    // без анимаций — пропадает сразу
    await page.evaluate(() => document.body.classList.add('no-motion', 'no-ui-anim'));
    await page.locator('#menu-hide .main-switch', { hasText: 'Кнопки импорта' }).click();
    expect(await importGroup.isHidden()).toBe(true);
    void board;
  });

  test('подписи координатной плоскости — переключатель в меню фона', async ({ board, page }) => {
    // в настройках такого пункта больше нет
    await page.locator('#btn-settings').dispatchEvent('click');
    await expect(page.locator('#settings-popover label', { hasText: 'Деления' })).toHaveCount(0);
    await page.locator('#btn-settings').dispatchEvent('click');
    // для клетки переключателя нет
    await page.locator('#view-grid-icon').click();
    await expect(page.locator('#view-menu .grid-switch')).toHaveCount(0);
    await page.locator('#view-menu button', { hasText: 'Координатная плоскость' }).click();
    // для координатной плоскости он есть и включён по умолчанию
    await page.locator('#view-grid-icon').click();
    const cb = page.locator('#view-menu .grid-switch input');
    await expect(cb).toBeChecked();
    // пока деления включены, на иконке плоскости виден ноль в начале координат
    await expect(page.locator('#view-grid-icon .coord-zero')).toHaveCount(1);
    await cb.uncheck();
    await expect(page.locator('#view-grid-icon .coord-zero')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__doska.state.board.coordLabels)).toBe(false);
    // и выключенное состояние переживает перезагрузку (сохранено вместе с фоном страницы)
    await page.reload();
    await board.ready();
    expect(await page.evaluate(() => (window as any).__doska.state.board.coordLabels)).toBe(false);
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
    await page.locator('#btn-settings').dispatchEvent('click');
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

    await page.locator('#btn-settings').dispatchEvent('click');
    await expect(page.locator('#settings-popover button', { hasText: /^Улучшенные$/ })).toHaveClass(/active/);
    await page.locator('#settings-popover button', { hasText: /^Выкл$/ }).click();
    expect((await board.state()).settings.animationMode).toBe('off');
    expect(await anim('#settings-popover')).toBe('none');
    await page.keyboard.press('Escape');
    await board.tool('p'); // у выделения выбора цвета на панели нет
    await page.locator('#btn-style').click();
    expect(await anim('.ctx-panel[data-kind="style"]')).toBe('none');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Comma');
    expect(await anim('.sd-window')).toBe('none');
    await expect(page.locator('.sd-general button', { hasText: /^Выкл$/ })).toHaveClass(/active/);
    await page.keyboard.press('Escape');

    await page.reload();
    await board.ready();
    expect((await board.state()).settings.animationMode).toBe('off');
    await page.locator('#btn-shapes').click();
    expect(await anim('.ctx-panel[data-kind="shapes"]')).toBe('none');
  });

  test('кнопки отмены и повтора можно скрыть', async ({ board, page }) => {
    const group = page.locator('#topbar .undo-group');
    await expect(page.locator('#btn-undo')).toBeVisible();
    await expect(page.locator('#btn-redo')).toBeVisible();

    await page.locator('#btn-settings').dispatchEvent('click');
    const cb = page.locator('#settings-popover label', { hasText: 'Скрыть кнопки отмены и повтора' }).locator('input');
    await expect(cb).not.toBeChecked();
    await cb.check();
    expect((await board.state()).settings.hideUndoRedo).toBe(true);
    await expect(page.locator('#btn-undo')).toBeHidden();
    await expect(page.locator('#btn-redo')).toBeHidden();
    // плашка кнопок уходит вместе с ними, пустой рамки не остаётся
    await expect(group).toBeHidden();
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
    await expect(group).toBeVisible();
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
    expect((await board.state()).grid).toBe('dots');
  });

  test('список сеток: иконки, отметка текущей, Esc закрывает', async ({ board, page }) => {
    const trigger = page.locator('#view-grid-icon');
    const menu = page.locator('#view-menu');
    await trigger.click();
    // кнопка с иконкой сетки открывает меню сразу на подменю «Тип сетки» (со стрелкой «назад»)
    await expect(menu.locator('.view-back')).toHaveText('Тип сетки›');
    const options = menu.locator('[data-grid]');
    await expect(options).toHaveText(['Без фона', 'Точки', 'Клетка✓', 'Координатная плоскость']);
    for (const o of await options.all()) await expect(o.locator('svg')).toHaveCount(1);
    await options.filter({ hasText: 'Координатная плоскость' }).click();
    await expect(menu).toBeHidden();
    expect((await board.state()).grid).toBe('coord');
    // на кнопке в шапке — иконка выбранной сетки
    expect(await trigger.innerHTML()).toBe(await options.last().locator('svg').evaluate(e => e.outerHTML));
    await trigger.click();
    await expect(options.last()).toHaveText('Координатная плоскость✓');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
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

  test('в браузере кнопка совместной работы есть: комната живёт во вкладке', async ({ board, page }) => {
    await expect(page.locator('#btn-share')).toBeVisible();
    // окно демонстрации из шапки убрано (кнопка скрыта)
    await expect(page.locator('#btn-present')).toBeHidden();
    void board;
  });
});

test.describe('вёрстка шапки', () => {
  test('«Поделиться» — текстом, «Вид и масштаб» и помощь внизу справа, F1 открывает помощь, экспорт скрывается из меню', async ({ board, page }) => {
    await expect(page.locator('#btn-share')).toHaveText('Поделиться');
    await expect(page.locator('#btn-share .share-icon')).toBeHidden();
    await expect(page.locator('#btn-settings')).toBeHidden();
    const vp = page.viewportSize()!;
    const view = (await page.locator('.view-group').boundingBox())!;
    const help = (await page.locator('.help-group').boundingBox())!;
    expect(view.y + view.height).toBeGreaterThan(vp.height - 30);
    expect(help.x).toBeGreaterThan(view.x + view.width);
    // экспорт — отдельная плашка справа от импорта
    const imp = (await page.locator('.import-group').boundingBox())!;
    const exp = (await page.locator('.export-group').boundingBox())!;
    expect(exp.x).toBeGreaterThan(imp.x + imp.width);

    // F1 и «Помощь» — боковая панель в режиме «Справка» (SPEC_CHAT §5)
    await page.keyboard.press('F1');
    await expect(page.locator('#side-panel')).toBeVisible();
    await expect(page.locator('#side-panel .sp-mode')).toHaveAttribute('data-value', 'help');
    await expect(page.locator('#btn-help')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('F1');
    await expect(page.locator('#side-panel')).toBeHidden();
    await page.locator('#btn-help').click();
    await expect(page.locator('#side-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#side-panel')).toBeHidden();

    await page.locator('#btn-home').click();
    await page.locator('#main-menu [data-section="hide"]').click();
    const item = page.locator('#main-menu [data-action="hide-export"]');
    await expect(item).not.toBeChecked();
    await item.click();
    await expect(item).toBeChecked();
    await expect(page.locator('#btn-export')).toBeHidden();
    await page.reload();
    await board.ready();
    await expect(page.locator('#btn-export')).toBeHidden();
  });
});

test.describe('всплывающие меню', () => {
  test('открыто одно меню: новое закрывает прежнее, и с клавиатуры тоже', async ({ board, page }) => {
    const shown = () => page.evaluate(() => ['main-menu', 'export-menu', 'view-menu', 'icon-picker', 'share-dialog']
      .filter(id => { const e = document.getElementById(id); return !!e && !e.hidden; }).join(','));
    await page.locator('#btn-home').click();
    await expect.poll(shown).toBe('main-menu');
    // F1 открывает боковую панель «Справка»: открытое меню закрывается, панель — не всплывающее меню
    await page.keyboard.press('F1');
    await expect.poll(shown).toBe('');
    await expect(page.locator('#side-panel')).toBeVisible();
    await page.locator('#btn-export').focus();
    await page.keyboard.press('Enter');
    await expect.poll(shown).toBe('export-menu');
    await page.locator('#btn-share').click();
    await expect.poll(shown).toBe('share-dialog');
    await page.locator('#zoom-label').focus();
    await page.keyboard.press('Enter');
    await expect.poll(shown).toBe('view-menu');
    await page.locator('#project-icon').click();
    await expect.poll(shown).toBe('icon-picker');
    await page.keyboard.press('Escape');
    await expect.poll(shown).toBe('');
    void board;
  });

  test('«Масштаб, вид и взаимодействия»: шириной с группу; «Фон страницы» открывается внутри меню, «назад» возвращает', async ({ board, page }) => {
    const menu = page.locator('#view-menu');
    await page.locator('#zoom-label').click();
    await expect(menu).toBeVisible();
    const width = async () => [(await page.locator('.view-group').boundingBox())!.width, (await menu.boundingBox())!.width];
    await expect.poll(async () => { const [g, m] = await width(); return Math.abs(g - m); }).toBeLessThan(1);
    await menu.locator('[data-view="background"]').click();
    await expect(menu.locator('.view-back')).toHaveText('Фон страницы›');
    await expect(menu.locator('[data-bg]')).toHaveCount(10);
    await expect(menu.locator('[data-zoom]')).toHaveCount(0);
    await menu.locator('.view-back').click();
    await expect(menu.locator('[data-zoom]')).toHaveCount(6);
    await expect(menu.locator('.view-back')).toHaveCount(0);
    await menu.locator('[data-view="background"]').click();
    await menu.locator('[data-bg="#fff8db"]').click();
    await expect(menu).toBeHidden();
    expect(await page.evaluate(() => (window as any).__doska.state.board.backgroundColor)).toBe('#fff8db');
    void board;
  });
});

test.describe('адаптивная шапка', () => {
  test('при сужении уходят экспорт, импорт, отмена/повтор переезжают под панель, «Поделиться» — иконкой; пункты «Скрыть» без места недоступны', async ({ board, page }) => {
    const fit = () => page.evaluate(() => [...document.body.classList].filter(c => c.startsWith('fit-')).sort().join(' '));
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(fit).toBe('');
    // слева от «Поделиться» всегда есть мой аватар (группа аватаров: 48 px и промежуток),
    // справа — кнопка «Чат и уведомления» (48 px и промежуток): она не уходит из шапки
    await page.setViewportSize({ width: 680, height: 800 });
    await expect.poll(fit).toBe('fit-export');
    await expect(page.locator('#btn-export')).toBeHidden();
    await expect(page.locator('#btn-import')).toBeVisible();

    await page.locator('#btn-home').click();
    await page.locator('#main-menu [data-section="hide"]').click();
    await expect(page.locator('#main-menu [data-action="hide-export"]')).toBeDisabled();
    await expect(page.locator('#main-menu [data-action="imports"]')).toBeEnabled();
    await expect(page.locator('#main-menu [data-action="undo"]')).toBeEnabled();
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 330, height: 800 });
    await expect.poll(fit).toBe('fit-export fit-import fit-share fit-undo');
    await expect(page.locator('#btn-share .share-icon')).toBeVisible();
    await expect(page.locator('#btn-share .share-text')).toBeHidden();
    // отмена и повтор — под панелью инструментов, одна над другой
    const tb = (await page.locator('#toolbar').boundingBox())!;
    const undo = (await page.locator('#btn-undo').boundingBox())!;
    const redo = (await page.locator('#btn-redo').boundingBox())!;
    expect(undo.y).toBeGreaterThan(tb.y + tb.height);
    expect(redo.y).toBeGreaterThan(undo.y + undo.height - 1);
    expect(Math.abs(undo.x - redo.x)).toBeLessThan(1);
    expect(await page.locator('#topbar').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(fit).toBe('');
    void board;
  });
});

test.describe('подсказки', () => {
  test('наведение на кнопку панели показывает морфящуюся подсказку с хоткеем', async ({ page }) => {
    await page.locator('.tool[data-tool="text"]').hover();
    const tip = page.locator('#morph-tip .mt-tip');
    await expect(tip).toBeVisible();
    const lab = page.locator('#morph-tip .mt-lab.cur');
    await expect(lab).toContainText('Текст');
    await expect(lab.locator('.mt-kbd')).toHaveText('T');
    await expect(tip).toHaveAttribute('data-side', 'right');
    await page.mouse.move(900, 500);
    await expect(tip).toBeHidden();
  });

  test('подсказка перетекает к соседней кнопке: не гаснет и меняет надпись', async ({ page }) => {
    await page.locator('.tool[data-tool="text"]').hover();
    await expect(page.locator('#morph-tip .mt-lab.cur')).toContainText('Текст');
    const before = (await page.locator('#morph-tip .mt-tip').boundingBox())!;
    await page.locator('.tool[data-tool="note"]').hover();
    await expect(page.locator('#morph-tip .mt-lab.cur')).toContainText('Стикер');
    await expect(page.locator('#morph-tip .mt-tip')).toBeVisible();
    // пузырь поехал вдоль панели вниз, и стоит напротив новой кнопки
    const btn = (await page.locator('.tool[data-tool="note"]').boundingBox())!;
    await expect.poll(async () => {
      const b = (await page.locator('#morph-tip .mt-tip').boundingBox())!;
      return Math.abs(b.y + b.height / 2 - (btn.y + btn.height / 2));
    }).toBeLessThan(2);
    expect((await page.locator('#morph-tip .mt-tip').boundingBox())!.y).toBeGreaterThan(before.y);
  });

  test('режим «Анимации»: по умолчанию «Улучшенные», «Обычные» возвращают обычный пузырь', async ({ board, page }) => {
    expect((await board.state()).settings.animationMode).toBe('enhanced');
    await page.keyboard.press('Control+Comma');
    await expect(page.locator('.sd-general button', { hasText: /^Улучшенные$/ })).toHaveClass(/active/);
    await page.locator('.sd-general button', { hasText: /^Обычные$/ }).click();
    expect((await board.state()).settings.animationMode).toBe('normal');
    await page.keyboard.press('Escape');
    await page.locator('.tool[data-tool="text"]').hover();
    await expect(page.locator('#tooltip')).toBeVisible();
    await expect(page.locator('#morph-tip .mt-tip')).toBeHidden();

    await page.reload();
    await board.ready();
    expect((await board.state()).settings.animationMode).toBe('normal');
    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-general button', { hasText: /^Улучшенные$/ }).click();
    await page.keyboard.press('Escape');
    await page.mouse.move(900, 500);
    await page.locator('.tool[data-tool="text"]').hover();
    await expect(page.locator('#morph-tip .mt-tip')).toBeVisible();
  });

  test('подменю «Взаимодействия» в МВВ: подсветка и подсказка как у панели, подсказка слева', async ({ board, page }) => {
    await page.locator('#zoom-label').click();
    const menu = page.locator('#view-menu');
    await menu.locator('[data-view="interactions"]').click();
    const snap = menu.locator('.view-switch', { hasText: 'Привязка к сетке' });
    await snap.hover();
    const tip = page.locator('#morph-tip .mt-tip');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveAttribute('data-side', 'left');
    await expect(page.locator('#morph-tip .mt-lab.cur')).toContainText('узлы сетки');
    await expect(menu.locator('.view-page > .mt-hl')).toHaveCount(1);
    // пузырь целиком левее меню
    await expect.poll(async () => {
      const t = (await tip.boundingBox())!, m = (await menu.boundingBox())!;
      return t.x + t.width <= m.x;
    }).toBe(true);
    // перетекает к соседнему переключателю
    await menu.locator('.view-switch', { hasText: 'Направляющие' }).hover();
    await expect(page.locator('#morph-tip .mt-lab.cur')).toContainText('пунктир');
    await expect(tip).toHaveAttribute('data-side', 'left');
    // «назад» — без подсказки: пузырь уходит
    await menu.locator('.view-back').hover();
    await expect(tip).toBeHidden();

    // «Обычные» анимации: обычный пузырь, тоже слева
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-general button', { hasText: /^Обычные$/ }).click();
    await page.keyboard.press('Escape');
    await page.locator('#zoom-label').click();
    await menu.locator('[data-view="interactions"]').click();
    await snap.hover();
    await expect(page.locator('#tooltip')).toBeVisible();
    await expect(page.locator('#tooltip')).toHaveAttribute('data-side', 'left');
    void board;
  });

  test('обычный пузырь вне панели инструментов работает как раньше', async ({ page }) => {
    await page.locator('#btn-pages').hover();
    await expect(page.locator('#tooltip')).toBeVisible();
    await expect(page.locator('#morph-tip .mt-tip')).toBeHidden();
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
    const [dl] = await Promise.all([page.waitForEvent('download'), board.exportPng()]);
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

  test('пустая страница — предупреждение', async ({ board, page }) => {
    const msg = new Promise<string>(resolve => page.once('dialog', d => { resolve(d.message()); void d.dismiss(); }));
    await board.exportPng();
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
    // вставленная картинка выделена, инструмент — «Выделение»: её сразу можно двигать
    expect((await board.state()).selection).toEqual([img.id]);
    expect((await board.state()).tool).toBe('select');
    await expect(page.locator('.tool[data-tool="select"]')).toHaveClass(/active/);
  });

  test('объектный ластик не стирает картинки и страницы PDF', async ({ board, page }) => {
    const png = await makePng(page, 400, 200);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-image').click()]);
    await chooser.setFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => board.count('image')).toBe(1);
    const img = (await board.elements())[0];
    const cy = img.y + img.h / 2;
    await board.tool('p');
    await board.drag([{ x: img.x + 50, y: cy }, { x: img.x + img.w - 50, y: cy }]);
    await board.tool('e');
    await board.drag([{ x: img.x + img.w / 2, y: img.y - 20 }, { x: img.x + img.w / 2, y: img.y + img.h + 20 }]);
    expect((await board.elements()).map(e => e.type)).toEqual(['image']);
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
    // ручка поворота — у левого верхнего угла, на 13 px экрана по каждой оси (ROT_HANDLE_OFF_PX в geom.ts); угол считается
    // от направления «центр → левый верхний угол», поворот на 90° — точка в направлении (h, −w) от центра
    const off = 13 / (await board.state()).camera.zoom;
    const hx = img2.x - off, hy = img2.y - off;
    const r = Math.hypot(img2.w, img2.h);
    const tx = cx + (img2.h / r) * 200, ty = cy - (img2.w / r) * 200;
    await board.drag([{ x: hx, y: hy }, { x: (hx + tx) / 2 + 40, y: (hy + ty) / 2 - 40 }, { x: tx, y: ty }], { steps: 10 });
    expect((await board.elements())[0].rot).toBeCloseTo(Math.PI / 2, 2);
  });

  test('картинка масштабируется пропорционально без Ctrl; настройкой можно выключить', async ({ board, page }) => {
    const png = await makePng(page, 200, 100);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-image').click()]);
    await chooser.setFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => board.count('image')).toBe(1);
    expect((await board.state()).settings.keepImageAspect).toBe(true);
    const img = (await board.elements())[0];
    // угол тянем только вправо — высота следует за шириной
    await board.drag([{ x: img.x + img.w, y: img.y + img.h }, { x: img.x + img.w + 100, y: img.y + img.h }]);
    const a = (await board.elements())[0];
    expect(a.w).toBeCloseTo(300, 0);
    expect(a.h).toBeCloseTo(150, 0);
    // боковая ручка тоже не искажает: высота растёт от середины
    await board.drag([{ x: a.x + a.w, y: a.y + a.h / 2 }, { x: a.x + a.w + 60, y: a.y + a.h / 2 }]);
    const b = (await board.elements())[0];
    expect(b.w).toBeCloseTo(360, 0);
    expect(b.h).toBeCloseTo(180, 0);
    expect(b.y + b.h / 2).toBeCloseTo(a.y + a.h / 2, 0);

    await page.locator('#btn-settings').dispatchEvent('click');
    const cb = page.locator('#settings-popover label', { hasText: 'Пропорциональный размер изображений' }).locator('input');
    await expect(cb).toBeChecked();
    await cb.uncheck();
    await page.keyboard.press('Escape');
    expect((await board.state()).settings.keepImageAspect).toBe(false);
    await board.drag([{ x: b.x + b.w, y: b.y + b.h }, { x: b.x + b.w + 100, y: b.y + b.h }]);
    const c = (await board.elements())[0];
    expect(c.w).toBeCloseTo(460, 0);
    expect(c.h).toBeCloseTo(180, 0);
    // с Shift — снова пропорционально
    await board.drag([{ x: c.x + c.w, y: c.y + c.h }, { x: c.x + c.w + 46, y: c.y + c.h }], { modifiers: ['Shift'] });
    const d = (await board.elements())[0];
    expect(d.w / d.h).toBeCloseTo(460 / 180, 1);

    await page.reload();
    await board.ready();
    expect((await board.state()).settings.keepImageAspect).toBe(false);
  });

  test('битый файл — сообщение об ошибке', async ({ board, page }) => {
    const msg = new Promise<string>(resolve => page.once('dialog', d => { resolve(d.message()); void d.dismiss(); }));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-image').click()]);
    await chooser.setFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    expect(await msg).toBe('Не удалось прочитать изображение');
    expect(await board.count()).toBe(0);
  });

  test('перо вне картинки не прилипает, когда картинку проводят под ним', async ({ board, page }) => {
    const png = await makePng(page, 400, 200);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#btn-image').click()]);
    await chooser.setFiles({ name: 'pic.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => board.count('image')).toBe(1);
    const img = (await board.elements())[0];

    // перо на картинке и перо вне её
    await board.tool('p');
    await board.drag([{ x: img.x + 60, y: img.y + 30 }, { x: img.x + img.w - 60, y: img.y + 30 }]);
    const outsideX = img.x + img.w + 100;
    await board.drag([{ x: outsideX, y: img.y + img.h / 2 }, { x: outsideX + 100, y: img.y + img.h / 2 }]);
    const strokes = (await board.elements()).filter(e => e.type === 'stroke');
    expect(strokes).toHaveLength(2);
    expect(strokes[0].baseId).toBe(img.id);
    expect(strokes[1].baseId).toBeNull();
    const outside = strokes[1].pts.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));

    // картинку проводим под внешним пером, затем ещё раз — в другое место
    await board.tool('v');
    const grab = { x: img.x + 40, y: img.y + img.h - 30 };
    await board.drag([{ ...grab }, { x: grab.x + 220, y: grab.y }]);
    let els = await board.elements();
    const moved = els.find(e => e.type === 'image')!;
    expect(moved.x).toBeCloseTo(img.x + 220, 0);
    // внешнее перо осталось на месте, хотя геометрически уже лежит на картинке
    expect(els.filter(e => e.type === 'stroke')[1].pts.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }))).toEqual(outside);

    const grab2 = { x: moved.x + 40, y: moved.y + moved.h - 30 };
    await board.drag([{ ...grab2 }, { x: grab2.x - 100, y: grab2.y }]);
    els = await board.elements();
    expect(els.filter(e => e.type === 'stroke')[1].pts.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }))).toEqual(outside);
    // а перо, нарисованное на картинке, уехало вместе с ней
    expect(els.filter(e => e.type === 'stroke')[0].pts[0].x).toBeCloseTo(strokes[0].pts[0].x + 120, 0);
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
