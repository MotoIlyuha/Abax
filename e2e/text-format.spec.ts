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

  test('меню выделения при вводе остаётся; Ctrl+B и Ctrl+I; Ctrl+Z, X, C, V - с текстом', async ({ board, page }) => {
    await startText(board, 'abc');
    const editor = page.locator('#overlay [contenteditable].inplace-edit');
    const qm = board.quickMenu;
    const panel = page.getByRole('group', { name: 'Форматирование текста' });
    await expect(qm).toBeVisible();
    await qm.getByRole('button', { name: 'Форматирование', exact: true }).click();
    await expect(panel.locator('.qm-text-b')).toBeVisible();
    await expect(qm.locator('.qm-font-val')).toHaveValue('24');

    await page.keyboard.press('Control+b');
    await expect(panel.locator('.qm-text-b')).toHaveClass(/active/);
    await expect(editor).toHaveCSS('font-weight', '700');
    // кнопка меню фокус у редактора не забирает
    await panel.locator('.qm-text-i').click();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveCSS('font-style', 'italic');
    await page.keyboard.press('Control+i');
    await expect(panel.locator('.qm-text-i')).not.toHaveClass(/active/);

    // буфер обмена и отмена — у поля ввода, доска не меняется
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    await page.keyboard.press('End');
    await page.keyboard.press('Control+v');
    await expect(editor).toHaveText('abcabc');
    await page.keyboard.press('Control+z');
    await expect(editor).toHaveText('abc');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+x');
    await expect(editor).toHaveText('');
    await page.keyboard.press('Control+v');
    await expect(editor).toHaveText('abc');
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
  test('стрелки - по готовым значениям, ввод вручную с проверкой, панель со слайдером', async ({ board, page }) => {
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
    await expect(val).toHaveAttribute('title', 'Размер - от 6 до 400');
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

  test('кегль нового текста меняют прямо при вводе - фокус остаётся в редакторе', async ({ board, page }) => {
    await startText(board, 'ab');
    const editor = page.locator('#overlay [contenteditable].inplace-edit');
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
  test('выравнивание по горизонтали и вертикали; кегль - свой или «Авто»', async ({ board, page }) => {
    await board.rect(400, 300, 640, 460);
    await page.keyboard.type('ab');
    const editor = page.locator('#overlay [contenteditable].inplace-edit.shape');
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

test.describe('форматирование фрагмента', () => {
  test('начертание и цвет остаются на выделенном слове после сохранения и повторного открытия', async ({ board, page }) => {
    await startText(board, 'обычный важный');
    const editor = page.getByRole('textbox', { name: 'Текст', exact: true });
    const qm = board.quickMenu;
    for (let i = 0; i < 'важный'.length; i++) await editor.press('Shift+ArrowLeft');

    const panel = page.getByRole('group', { name: 'Форматирование текста' });
    await expect(panel).toHaveCount(0);
    await qm.getByRole('button', { name: 'Форматирование', exact: true }).click();
    for (const name of ['Полужирный', 'Курсив', 'Подчёркнутый', 'Зачёркнутый']) {
      await panel.getByRole('button', { name }).click();
    }
    await qm.locator('.qm-style').click();
    await page.locator('.ctx-swatches [data-c="#bd0a0a"]').click();
    await expect(editor).toBeFocused();
    const word = editor.getByText('важный', { exact: true });
    await expect(word).toHaveCSS('text-decoration-line', 'underline line-through');
    await expect(word).toHaveCSS('color', 'rgb(189, 10, 10)');

    await editor.press('Enter');
    const runs = [{ n: 8 }, { n: 6, bold: true, italic: true, underline: true, strike: true, color: '#bd0a0a' }];
    expect((await board.elements())[0]).toMatchObject({ text: 'обычный важный', color: '#1f2329', runs });

    await expect.poll(async () => (await board.state()).dirty).toBe(false);
    await page.reload();
    await board.ready();
    await board.dblclick({ x: 410, y: 297 });
    await expect(word).toHaveCSS('color', 'rgb(189, 10, 10)');
    await editor.press('ArrowLeft');
    await editor.press('Shift+ArrowLeft');
    await editor.press('Control+u');
    await editor.press('Enter');
    expect((await board.elements())[0].runs).toEqual([
      { n: 8 },
      { ...runs[1], n: 4 },
      { n: 1, bold: true, italic: true, strike: true, color: '#bd0a0a' },
      { ...runs[1], n: 1 },
    ]);
    await page.keyboard.press('Control+z');
    expect((await board.elements())[0].runs).toEqual(runs);
  });

  test('у надписи внутри фигуры цвет фрагмента сохраняется отдельно от цвета рамки', async ({ board, page }) => {
    const rect = await board.rect(400, 300, 640, 460);
    await page.keyboard.type('red blue');
    const editor = page.getByRole('textbox', { name: 'Надпись фигуры' });
    for (let i = 0; i < 4; i++) await editor.press('Shift+ArrowLeft');
    await editor.press('Control+u');
    await board.quickMenu.locator('.qm-style').click();
    await expect(page.getByRole('button', { name: 'Текст', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.ctx-swatches [data-c="#305bab"]').click();
    await editor.press('Enter');
    expect((await board.elements())[0]).toMatchObject({
      color: rect.color,
      text: 'red blue',
      runs: [{ n: 4 }, { n: 4, underline: true, color: '#305bab' }],
    });
  });
});
