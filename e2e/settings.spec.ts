import type { Locator, Page } from '@playwright/test';
import { byTip, expect, test } from './fixtures';

const dialog = (page: Page) => page.locator('#settings-dialog');
const editor = (page: Page) => page.locator('#settings-dialog .tbe');
const row = (page: Page, tool: string) => editor(page).locator(`.tbe-row[data-tool="${tool}"]`);
const toolbarOrder = (page: Page) => page.locator('#toolbar .tool').evaluateAll(bs =>
  bs.map(b => (b as HTMLElement).dataset.tool ?? b.id));

async function openToolbarSettings(page: Page): Promise<void> {
  await page.locator('#btn-settings').click();
  await page.locator('#settings-popover .settings-all').click();
  await page.locator('.sd-nav-item[data-section="toolbar"]').click();
  await expect(editor(page)).toBeVisible();
}

/**
 * Перетаскивание мышью: from — за что взять, to — куда бросить;
 * at — доля высоты цели (0.1 — верхний край, 0.5 — середина).
 */
async function drag(page: Page, from: Locator, to: Locator, at = 0.5, dx = 0.5): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + a.width * 0.35, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width * 0.35, a.y + a.height / 2 + 8, { steps: 2 });
  await to.scrollIntoViewIfNeeded();
  const b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width * dx, b.y + b.height * at, { steps: 8 });
  await page.mouse.up();
}

test.describe('окно «Все настройки»', () => {
  test('открывается из настроек доски и по Ctrl+, закрывается Esc, крестиком и кликом мимо', async ({ page }) => {
    await page.locator('#btn-settings').click();
    await page.locator('#settings-popover .settings-all').click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#settings-popover')).toBeHidden();
    await expect(page.locator('.sd-nav-item')).toHaveText(['Доска', 'Панель инструментов', 'Горячие клавиши']);
    await expect(page.locator('#sd-title')).toHaveText('Доска');

    // раздел «Доска» — те же настройки, что в поповере
    await page.locator('.sd-general button', { hasText: 'Сверху' }).click();
    await expect(page.locator('#toolbar')).toHaveAttribute('data-pos', 'top');
    await expect(page.locator('.sd-general button', { hasText: 'Сверху' })).toHaveClass(/active/);

    await page.locator('.sd-nav-item', { hasText: 'Панель инструментов' }).click();
    await expect(page.locator('#sd-title')).toHaveText('Панель инструментов');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);

    // открывается на последнем разделе
    await page.keyboard.press('Control+Comma');
    await expect(page.locator('#sd-title')).toHaveText('Панель инструментов');
    await page.locator('.sd-close').click();
    await expect(dialog(page)).toHaveCount(0);

    await page.keyboard.press('Control+Comma');
    await page.mouse.click(10, 450);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('пока окно открыто, клавиши не достаются доске', async ({ board, page }) => {
    await board.rect(300, 300, 400, 400);
    await board.tool('v');
    await board.click({ x: 300, y: 350 });
    expect((await board.state()).selection).toHaveLength(1);
    await page.keyboard.press('Control+Comma');
    await page.keyboard.press('Delete');
    await page.keyboard.press('e');
    await page.keyboard.press('Control+z');
    expect(await board.count()).toBe(1);
    expect((await board.state()).tool).toBe('select');
    await page.keyboard.press('Escape');
    await page.keyboard.press('e');
    expect((await board.state()).tool).toBe('eraser');
  });
});

test.describe('настройка панели инструментов', () => {
  test('порядок кнопок меняется перетаскиванием и сохраняется', async ({ board, page }) => {
    await openToolbarSettings(page);
    expect((await toolbarOrder(page)).slice(0, 3)).toEqual(['select', 'pan', 'pen']);
    await drag(page, row(page, 'pen'), row(page, 'select'), 0.1);
    await expect(editor(page).locator('.tbe-list[data-list="items"] > .tbe-entry').first()).toHaveAttribute('data-tool', 'pen');
    expect((await toolbarOrder(page)).slice(0, 3)).toEqual(['pen', 'select', 'pan']);
    // нижний край строки — вставка после неё
    await drag(page, row(page, 'pen'), row(page, 'pan'), 0.9);
    expect((await toolbarOrder(page)).slice(0, 3)).toEqual(['select', 'pan', 'pen']);
    await drag(page, row(page, 'select'), row(page, 'pen'), 0.9);
    expect((await toolbarOrder(page)).slice(0, 3)).toEqual(['pan', 'pen', 'select']);

    await page.reload();
    await board.ready();
    expect((await toolbarOrder(page)).slice(0, 3)).toEqual(['pan', 'pen', 'select']);
  });

  test('инструмент, брошенный на другой, образует именованную группу', async ({ board, page }) => {
    await openToolbarSettings(page);
    await drag(page, row(page, 'eraser'), row(page, 'pen'), 0.5);
    const name = editor(page).locator('input.tbe-group-name');
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('Группа 1');
    await name.fill('Рисование');
    await page.keyboard.press('Enter');
    const card = editor(page).locator('.tbe-group', { hasText: 'Рисование' });
    await expect(card.locator('.tbe-row')).toHaveCount(2);

    // в группу можно добавить ещё инструмент — бросить на её заголовок
    await drag(page, row(page, 'highlighter'), card.locator('.tbe-group-head'), 0.7);
    await expect(card.locator('.tbe-row')).toHaveCount(3);
    await page.keyboard.press('Escape');

    const btn = page.locator('#toolbar [data-tools="pen eraser highlighter"]');
    await expect(btn).toBeVisible();
    await expect(page.locator('#toolbar .tool[data-tool="pen"]')).toHaveCount(0);
    await btn.click();
    const panel = page.locator('.ctx-panel[data-kind="shapes"]');
    await expect(panel.locator('.ctx-title')).toHaveText('Рисование');
    await panel.locator('[data-shape="highlighter"]').click();
    expect((await board.state()).tool).toBe('highlighter');
    await expect(btn).toHaveClass(/active/);
    await expect(btn).toHaveAttribute('data-shape', 'highlighter');

    // переименование кликом по названию
    await page.keyboard.press('Control+Comma');
    await card.locator('.tbe-group-name').click();
    await editor(page).locator('input.tbe-group-name').fill('Пишем');
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0);
    await expect(editor(page).locator('.tbe-group', { hasText: 'Пишем' })).toHaveCount(1);

    // разгруппировать — инструменты встают на место группы
    await editor(page).locator('.tbe-group', { hasText: 'Пишем' }).locator('.tbe-ungroup').click();
    await expect(editor(page).locator('.tbe-group', { hasText: 'Пишем' })).toHaveCount(0);
    expect((await toolbarOrder(page)).slice(0, 5)).toEqual(['select', 'pan', 'pen', 'eraser', 'highlighter']);
  });

  test('новая группа кнопкой, инструмент перетаскивается в неё', async ({ page }) => {
    await openToolbarSettings(page);
    await editor(page).locator('.tbe-add-group').click();
    const name = editor(page).locator('input.tbe-group-name');
    await expect(name).toBeFocused();
    await name.fill('Пусто пока');
    await page.keyboard.press('Escape'); // Esc отменяет переименование, окно остаётся
    await expect(dialog(page)).toBeVisible();
    const card = editor(page).locator('.tbe-group', { hasText: 'Группа 1' });
    await expect(card.locator('.tbe-group-empty')).toBeVisible();
    // пустую группу на панель не выводим
    await expect(page.locator('#toolbar [data-ctx^="grp-"]')).toHaveCount(0);
    await drag(page, row(page, 'text'), card.locator('.tbe-group-empty'));
    await expect(card.locator('.tbe-row[data-tool="text"]')).toBeVisible();
    await expect(page.locator('#toolbar [data-tools="text"]')).toHaveCount(1);
  });

  test('скрытие кнопкой и перетаскиванием; скрытый инструмент доступен с клавиатуры', async ({ board, page }) => {
    await openToolbarSettings(page);
    await row(page, 'highlighter').locator('.tbe-hide').click();
    await expect(editor(page).locator('.tbe-list[data-list="hidden"] .tbe-row[data-tool="highlighter"]')).toBeVisible();
    await expect(page.locator('#toolbar .tool[data-tool="highlighter"]')).toHaveCount(0);

    // группа целиком — в «Скрытые»
    await drag(page, editor(page).locator('.tbe-group[data-group="shapes"] .tbe-group-head'), editor(page).locator('.tbe-list[data-list="hidden"]'), 0.8);
    await expect(editor(page).locator('.tbe-list[data-list="hidden"] .tbe-group[data-group="shapes"]')).toBeVisible();
    await expect(page.locator('#btn-shapes')).toHaveCount(0);

    // инструмент из скрытой группы — обратно на панель перетаскиванием
    await drag(page, row(page, 'ellipse'), row(page, 'select'), 0.1);
    expect((await toolbarOrder(page))[0]).toBe('ellipse');

    await page.keyboard.press('Escape');
    await board.tool('m');
    expect((await board.state()).tool).toBe('highlighter');
    await board.tool('r');
    expect((await board.state()).tool).toBe('rect');

    await page.reload();
    await board.ready();
    await expect(page.locator('#btn-shapes')).toHaveCount(0);
    await openToolbarSettings(page);
    await editor(page).locator('.tbe-group[data-group="shapes"] .tbe-group-head .tbe-show').click();
    await expect(page.locator('#btn-shapes')).toBeVisible();
  });

  test('горячие клавиши: назначение, конфликт, запрещённая, снятие', async ({ board, page }) => {
    await openToolbarSettings(page);
    const status = editor(page).locator('.tbe-status');
    const penKey = row(page, 'pen').locator('.tbe-key');
    await expect(penKey).toHaveText('P');

    await penKey.click();
    await expect(penKey).toHaveClass(/capturing/);
    await page.keyboard.press('b');
    await expect(status).toContainText('занята');
    await expect(status).toHaveClass(/error/);
    await page.keyboard.press('r');
    await expect(penKey).toHaveText('R');
    await expect(row(page, 'rect').locator('.tbe-key')).toHaveText('—');
    await expect(status).toContainText('Прямоугольник');

    // клавиша для инструмента, у которого её не было
    await row(page, 'cube').locator('.tbe-key').click();
    await page.keyboard.press('3');
    await expect(row(page, 'cube').locator('.tbe-key')).toHaveText('3');

    // Backspace снимает, Esc отменяет назначение
    await row(page, 'eraser').locator('.tbe-key').click();
    await page.keyboard.press('Backspace');
    await expect(row(page, 'eraser').locator('.tbe-key')).toHaveText('—');
    await row(page, 'text').locator('.tbe-key').click();
    await page.keyboard.press('Escape');
    await expect(row(page, 'text').locator('.tbe-key')).toHaveText('T');
    await expect(dialog(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(byTip(page.locator('#toolbar'), 'Перо (R)')).toHaveCount(1);
    await board.tool('t');
    await board.tool('r');
    expect((await board.state()).tool).toBe('pen');
    await board.tool('3');
    expect((await board.state()).tool).toBe('cube');
    await board.tool('e');
    expect((await board.state()).tool).toBe('cube');

    await page.reload();
    await board.ready();
    await board.tool('r');
    expect((await board.state()).tool).toBe('pen');
  });

  test('«Сбросить» возвращает панель по умолчанию', async ({ page }) => {
    await openToolbarSettings(page);
    const defaults = await toolbarOrder(page);
    await row(page, 'pen').locator('.tbe-hide').click();
    await row(page, 'select').locator('.tbe-key').click();
    await page.keyboard.press('q');
    expect(await toolbarOrder(page)).not.toEqual(defaults);
    page.once('dialog', d => void d.accept());
    await editor(page).locator('.tbe-reset').click();
    expect(await toolbarOrder(page)).toEqual(defaults);
    await expect(row(page, 'select').locator('.tbe-key')).toHaveText('V');
  });
});
