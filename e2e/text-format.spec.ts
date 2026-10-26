import { expect, test, type Board } from './fixtures';

/** Новый текст инструментом «Текст»: клик в точку и ввод (Enter — не нажимаем). */
async function startText(board: Board, text: string): Promise<void> {
  await board.tool('t');
  await board.click({ x: 400, y: 300 });
  await board.page.keyboard.type(text);
}

test.describe('ввод текста', () => {
  test('при вставке текста включается выделение, готовый текст выделен', async ({ board, page }) => {
    await board.tool('t');
    await board.click({ x: 400, y: 300 });
    expect((await board.state()).tool).toBe('select');
    await page.keyboard.type('x');
    await page.keyboard.press('Enter');
    const [t] = await board.elements();
    expect(t).toMatchObject({ type: 'text', text: 'x' });
    expect((await board.state()).selection).toEqual([t.id]);
  });

  test('меню выделения при вводе остаётся; Ctrl+B и Ctrl+I; Ctrl+Z, X, C, V — с текстом', async ({ board, page }) => {
    await startText(board, 'abc');
    const editor = page.locator('#overlay textarea');
    const qm = board.quickMenu;
    await expect(qm).toBeVisible();
    await expect(qm.locator('.qm-text-b')).toBeVisible();
    await expect(qm.locator('.qm-font-val')).toHaveValue('24');

    await page.keyboard.press('Control+b');
    await expect(qm.locator('.qm-text-b')).toHaveClass(/active/);
    await expect(editor).toHaveCSS('font-weight', '700');
    // кнопка меню фокус у редактора не забирает
    await qm.locator('.qm-text-i').click();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveCSS('font-style', 'italic');
    await page.keyboard.press('Control+i');
    await expect(qm.locator('.qm-text-i')).not.toHaveClass(/active/);

    // буфер обмена и отмена — у поля ввода, доска не меняется
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await page.keyboard.press('End');
    await page.keyboard.press('Control+v');
    await expect(editor).toHaveValue('abcabc');
    await page.keyboard.press('Control+z');
    await expect(editor).toHaveValue('abc');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+x');
    await expect(editor).toHaveValue('');
    await page.keyboard.press('Control+v');
    await expect(editor).toHaveValue('abc');
    expect(await board.count()).toBe(0);

    await page.keyboard.press('Enter');
    expect((await board.elements())[0]).toMatchObject({ text: 'abc', bold: true, size: 24 });
    expect((await board.elements())[0]).not.toHaveProperty('italic');
    // у выделенного текста Ctrl+B тоже работает
    await page.keyboard.press('Control+b');
    expect((await board.elements())[0].bold).toBe(false);
  });
});

test.describe('кегль текста', () => {
  test('стрелки — по готовым значениям, ввод вручную с проверкой, панель со слайдером', async ({ board, page }) => {
    await startText(board, 'Тема');
    await page.keyboard.press('Enter');
    const qm = board.quickMenu;
    const val = qm.locator('.qm-font-val');
    const [up, down] = [qm.locator('.qm-font-step').nth(0), qm.locator('.qm-font-step').nth(1)];
    await expect(val).toHaveValue('24');
    await up.click();
    await expect(val).toHaveValue('36');
    await down.click();
    await down.click();
    await expect(val).toHaveValue('18');
    expect((await board.elements())[0].size).toBe(18);

    // клик по числу — ввод и панель: слайдер и значения в ряд
    await val.click();
    const panel = page.locator('.ctx-panel[data-kind="font"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.ctx-font-chip')).toHaveText(['10', '12', '14', '18', '24', '36', '80', '144', '288']);
    await expect(panel.locator('.ctx-font-chip.active')).toHaveText('18');
    await expect(panel.locator('.ctx-range-track')).toBeVisible();
    await expect(val).toBeFocused();
    await page.keyboard.type('abc');
    await expect(val).toHaveClass(/invalid/);
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible(); // с ошибкой не применяется
    await val.fill('500');
    await expect(val).toHaveAttribute('title', 'Размер — от 6 до 400');
    await val.fill('50');
    await page.keyboard.press('Enter');
    await expect(panel).toHaveCount(0);
    expect((await board.elements())[0].size).toBe(50);

    // готовое значение из панели
    await val.click();
    await panel.locator('.ctx-font-chip', { hasText: '144' }).click();
    await expect(panel).toHaveCount(0);
    await expect(val).toHaveValue('144');
    expect((await board.elements())[0].size).toBe(144);

    // слайдер: значение в поле — следом; Esc закрывает панель
    await val.click();
    await board.settled();
    const track = (await panel.locator('.ctx-range-track').boundingBox())!;
    await page.mouse.click(track.x + 2, track.y + track.height / 2);
    const small = (await board.elements())[0].size;
    expect(small).toBeLessThan(10);
    await expect(val).toHaveValue(String(small));
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    expect((await board.elements())[0].size).toBe(small);
  });

  test('кегль нового текста меняют прямо при вводе — фокус остаётся в редакторе', async ({ board, page }) => {
    await startText(board, 'ab');
    const editor = page.locator('#overlay textarea');
    await board.quickMenu.locator('.qm-font-step').first().click();
    await expect(editor).toBeFocused();
    await board.quickMenu.locator('.qm-font-val').click();
    await page.keyboard.type('80');
    await page.keyboard.press('Enter');
    await expect(editor).toBeFocused();
    await page.keyboard.type('c');
    await page.keyboard.press('Enter');
    expect((await board.elements())[0]).toMatchObject({ text: 'abc', size: 80 });
  });
});

test.describe('надпись в фигуре', () => {
  test('выравнивание по горизонтали и вертикали; кегль — свой или «Авто»', async ({ board, page }) => {
    await board.rect(400, 300, 640, 460);
    await page.keyboard.type('ab');
    const editor = page.locator('#overlay textarea.inplace-edit.shape');
    const qm = board.quickMenu;
    await expect(qm.locator('.qm-align')).toBeVisible();
    await qm.locator('.qm-align').click();
    const panel = page.locator('.ctx-panel[data-kind="align"]');
    await expect(panel.locator('[data-align="center"]')).toHaveClass(/active/);
    await expect(panel.locator('[data-align="middle"]')).toHaveClass(/active/);
    await panel.locator('[data-align="left"]').click();
    await panel.locator('[data-align="bottom"]').click();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveCSS('text-align', 'left');
    await expect(panel.locator('[data-align="left"]')).toHaveClass(/active/);
    await page.keyboard.press('Escape'); // панель
    await page.keyboard.press('Escape'); // ввод готов
    expect((await board.elements())[0]).toMatchObject({ text: 'ab', align: 'left', valign: 'bottom' });

    // у надписи кегль подбирается; можно задать свой и вернуть «Авто»
    await qm.locator('.qm-font-val').click();
    const font = page.locator('.ctx-panel[data-kind="font"]');
    await expect(font.locator('.ctx-font-chip.active')).toHaveText('Авто');
    await font.locator('.ctx-font-chip', { hasText: '36' }).click();
    expect((await board.elements())[0].textSize).toBe(36);
    await qm.locator('.qm-font-val').click();
    await font.locator('.ctx-font-chip', { hasText: 'Авто' }).click();
    expect((await board.elements())[0]).not.toHaveProperty('textSize');

    // центр — по умолчанию и не хранится
    await qm.locator('.qm-align').click();
    await panel.locator('[data-align="center"]').click();
    await panel.locator('[data-align="middle"]').click();
    const r = (await board.elements())[0];
    expect(r).not.toHaveProperty('align');
    expect(r).not.toHaveProperty('valign');
  });
});
