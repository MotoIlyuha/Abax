import type { Page } from '@playwright/test';
import { expect, test, type Board } from './fixtures';
import { test as hostTest } from './host';

/** Окно «Все настройки» на разделе «Горячие клавиши». */
async function openHotkeys(board: Board): Promise<void> {
  await board.tool('Control+Comma');
  await board.page.locator('.sd-nav-item', { hasText: 'Горячие клавиши' }).click();
  await expect(board.page.locator('.sd-head h2')).toHaveText('Горячие клавиши');
}

const keysOf = (page: Page, selector: string) => page.locator(`${selector} kbd`);

test.describe('горячие клавиши страниц', () => {
  test('Alt + номер (по умолчанию) — переход на страницу с этим номером', async ({ board, page }) => {
    await board.addPage();
    await board.addPage();
    await expect(page.locator('#page-name')).toHaveValue('Страница 3');
    await board.tool('Alt+1');
    await expect(page.locator('#page-name')).toHaveValue('Страница 1');
    await board.tool('Alt+3');
    await expect(page.locator('#page-name')).toHaveValue('Страница 3');
    await board.tool('Alt+2');
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');
    // такой страницы нет, другой модификатор — ничего не происходит
    await board.tool('Alt+7');
    await board.tool('Control+1');
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');
    expect((await board.state()).project.pages).toHaveLength(3);
  });

  test('Ctrl + номер — после выбора в настройках; выбор сохраняется', async ({ board, page }) => {
    await board.addPage();
    await openHotkeys(board);
    await expect(page.locator('.hk-mods button', { hasText: 'Alt' })).toHaveClass(/active/);
    await page.locator('.hk-mods button', { hasText: 'Ctrl' }).click();
    await expect(page.locator('.hk-mods button', { hasText: 'Ctrl' })).toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-dialog')).toHaveCount(0);

    await board.tool('Control+1');
    await expect(page.locator('#page-name')).toHaveValue('Страница 1');
    await board.tool('Alt+2');
    await expect(page.locator('#page-name')).toHaveValue('Страница 1');
    await board.tool('Control+2');
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');

    await page.reload();
    await board.ready();
    expect((await board.state()).settings.pageKeyMod).toBe('ctrl');
  });

  test('новая страница по Alt+N; сочетание меняется в настройках', async ({ board, page }) => {
    await board.tool('Alt+n');
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');
    // подсказки плитки «+» называют сочетание
    await board.openPages();
    const tile = page.locator('#pages-list .page-add');
    expect(await tile.getAttribute('title') ?? await tile.getAttribute('data-tip')).toBe('Новая страница (Alt+N)');
    await board.tool('b');

    await openHotkeys(board);
    const cap = page.locator('.hk-capture');
    const status = page.locator('.hk-status');
    await expect(keysOf(page, '.hk-capture')).toHaveText(['Alt', 'N']);
    await cap.click();
    await expect(cap).toHaveClass(/capturing/);
    // занятое доской и одиночная клавиша не подходят
    await page.keyboard.press('Control+z');
    await expect(status).toHaveText('Ctrl+Z занято: отменить');
    await expect(status).toHaveClass(/error/);
    await page.keyboard.press('q');
    await expect(status).toContainText('Нужно сочетание с Ctrl или Alt');
    await page.keyboard.press('Alt+1');
    await expect(status).toHaveText('Alt+1 занято: переход на страницу 1');
    await page.keyboard.press('Alt+Shift+KeyP');
    await expect(cap).not.toHaveClass(/capturing/);
    await expect(keysOf(page, '.hk-capture')).toHaveText(['Alt', 'Shift', 'P']);
    await expect(status).toHaveText('Новая страница — Alt+Shift+P');
    await page.keyboard.press('Escape');

    await board.tool('Alt+Shift+KeyP');
    await expect(page.locator('#page-name')).toHaveValue('Страница 3');
    await board.tool('Alt+n');
    expect((await board.state()).project.pages).toHaveLength(3);

    await page.reload();
    await board.ready();
    expect((await board.state()).settings.newPageKey).toBe('Alt+Shift+KeyP');

    // Backspace снимает сочетание, «По умолчанию» возвращает Alt+N
    await openHotkeys(board);
    await page.locator('.hk-capture').click();
    await page.keyboard.press('Backspace');
    await expect(page.locator('.hk-capture')).toHaveText('—');
    expect((await board.state()).settings.newPageKey).toBeNull();
    await page.locator('.hk-reset').click();
    await expect(keysOf(page, '.hk-capture')).toHaveText(['Alt', 'N']);
    await expect(page.locator('.hk-reset')).toHaveCount(0);
  });

  test('сочетание новой страницы, совпавшее с переходом, снимается при смене модификатора', async ({ board, page }) => {
    await openHotkeys(board);
    await page.locator('.hk-capture').click();
    await page.keyboard.press('Control+5');
    await expect(keysOf(page, '.hk-capture')).toHaveText(['Ctrl', '5']);
    await page.locator('.hk-mods button', { hasText: 'Ctrl' }).click();
    await expect(page.locator('.hk-capture')).toHaveText('—');
    await expect(page.locator('.hk-status')).toContainText('сочетание новой страницы снято');
    expect((await board.state()).settings).toMatchObject({ pageKeyMod: 'ctrl', newPageKey: null });
  });

  test('при вводе текста сочетания страниц не срабатывают', async ({ board, page }) => {
    await board.addPage();
    const name = page.locator('#page-name');
    await name.focus();
    await page.keyboard.press('Alt+1');
    await page.keyboard.press('Alt+n');
    const s = await board.state();
    expect(s.project.pages).toHaveLength(2);
    expect(s.pageId).toBe(s.project.pages[1].id);
  });

  test('в браузере — предупреждения о занятых браузером сочетаниях', async ({ board, page }) => {
    await openHotkeys(board);
    const warns = page.locator('.hk-warn');
    // Alt+N браузер не занимает (Alt+1…9 занят только на Linux — там своё предупреждение)
    await expect(page.locator('.hk-warn', { hasText: 'Alt+N' })).toHaveCount(0);
    await page.locator('.hk-mods button', { hasText: 'Ctrl' }).click();
    await page.locator('.hk-capture').click();
    await page.keyboard.press('Control+n');
    await expect(warns).toHaveCount(2);
    await expect(warns.nth(0)).toContainText('Ctrl+1…9 переключают вкладки');
    await expect(warns.nth(1)).toContainText('В браузере Ctrl+N — новое окно');
    // свободное сочетание — без предупреждения
    await page.locator('.hk-capture').click();
    await page.keyboard.press('Alt+Shift+KeyP');
    await expect(warns).toHaveCount(1);
    await expect(warns).not.toContainText('Ctrl+N');
  });
});

hostTest('в приложении для компьютера предупреждений нет', async ({ host }) => {
  const page = host.page;
  await openHotkeys(host.board);
  await expect(page.locator('.hk-capture kbd')).toHaveText(['Alt', 'N']);
  await expect(page.locator('.hk-warn')).toHaveCount(0);
});

test.describe('раздел «Горячие клавиши»: справка', () => {
  test('показывает клавиши инструментов и постоянные сочетания доски', async ({ board, page }) => {
    await openHotkeys(board);
    const pen = page.locator('.hk-tool[data-tool="pen"]');
    await expect(pen).toContainText('Перо');
    await expect(pen.locator('kbd')).toHaveText(['P']);
    // без клавиши инструмент в списке не показывается
    await expect(page.locator('.hk-tool[data-tool="cube"]')).toHaveCount(0);

    const row = (what: string) => page.locator('.hk-row', { has: page.locator('.hk-what', { hasText: what }) });
    await expect(row('Удалить выделенное').locator('kbd')).toHaveText(['Delete', 'Backspace']);
    await expect(row('Выделить всё').locator('kbd')).toHaveText(['Ctrl', 'A']);
    await expect(row('Отменить').first().locator('kbd')).toHaveText(['Ctrl', 'Z']);
    await expect(row('Копировать').locator('kbd')).toHaveText(['Ctrl', 'C']);
    await expect(row('Вырезать').locator('kbd')).toHaveText(['Ctrl', 'X']);
    await expect(row('Вставить').locator('kbd')).toHaveText(['Ctrl', 'V']);

    // «Изменить» ведёт к назначению клавиш инструментов
    await page.locator('.hk-edit').click();
    await expect(page.locator('.sd-head h2')).toHaveText('Панель инструментов');
  });

  test('клавиша инструмента, назначенная в «Панели инструментов», видна в справке', async ({ board, page }) => {
    await board.tool('Control+Comma');
    await page.locator('.sd-nav-item', { hasText: 'Панель инструментов' }).click();
    const penKey = page.locator('.tbe-row[data-tool="pen"] .tbe-key');
    await penKey.click();
    await page.keyboard.press('j');
    await expect(penKey).toHaveText('J');
    await page.locator('.sd-nav-item', { hasText: 'Горячие клавиши' }).click();
    await expect(page.locator('.hk-tool[data-tool="pen"] kbd')).toHaveText(['J']);
  });

  test('без отдельной надписи про macOS; на Mac вместо Ctrl везде Cmd', async ({ board, page }) => {
    await openHotkeys(board);
    await expect(page.locator('.hk', { hasText: 'macOS' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }));
    await page.reload();
    await board.ready();
    const tip = (sel: string) => page.locator(sel).evaluate(e => e.getAttribute('title') ?? e.getAttribute('data-tip'));
    expect(await tip('#btn-undo')).toBe('Отменить (Cmd+Z)');
    expect(await tip('#btn-export')).toBe('Экспорт в PNG (Cmd+E)');

    await openHotkeys(board);
    const row = (what: string) => page.locator('.hk-row', { has: page.locator('.hk-what', { hasText: what }) });
    await expect(row('Выделить всё').locator('kbd')).toHaveText(['Cmd', 'A']);
    await expect(page.locator('.hk-mods button')).toHaveText(['Cmd + 1…9', 'Alt + 1…9']);
    await expect(keysOf(page, '.hk-capture')).toHaveText(['Alt', 'N']);
    // Cmd на Mac — это Ctrl: занятое сочетание подписано как Cmd
    await page.locator('.hk-capture').click();
    await page.keyboard.press('Meta+z');
    await expect(page.locator('.hk-status')).toHaveText('Cmd+Z занято: отменить');
    await expect(page.locator('.hk')).not.toContainText('Ctrl');
  });
});
