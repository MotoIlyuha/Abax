import type { Page } from '@playwright/test';
import { expect, test, type Board } from './fixtures';
import { test as hostTest } from './host';

const nav = (page: Page) => page.locator('#settings-dialog .sd-nav-item');

async function openSection(page: Page, id: string): Promise<void> {
  if (await page.locator('#settings-dialog').count() === 0) await page.keyboard.press('Control+Comma');
  await page.locator(`.sd-nav-item[data-section="${id}"]`).click();
}

/** Нажать и задержать логотип в «О проекте». */
async function holdLogo(page: Page): Promise<void> {
  const b = (await page.locator('#settings-dialog .sd-about-logo').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.mouse.up();
}

/** Раздел уже открыт (как будто логотип задерживали раньше). */
async function unlock(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.setItem('doska.experiments', '1'));
}

test.describe('раздел «Экспериментальные»', () => {
  test('появляется, если задержать логотип в «О проекте»; запоминается; скрывается кнопкой', async ({ board, page }) => {
    await openSection(page, 'about');
    await expect(nav(page)).toHaveText(['Доска', 'Панель инструментов', 'Горячие клавиши', 'О проекте']);
    // короткий клик по логотипу — ничего
    await page.locator('#settings-dialog .sd-about-logo').click();
    await expect(nav(page)).toHaveCount(4);
    await holdLogo(page);
    await expect(nav(page)).toHaveText(['Доска', 'Панель инструментов', 'Горячие клавиши', 'О проекте', 'Экспериментальные']);
    await expect(nav(page).last()).toHaveClass(/sd-nav-new/);
    await expect(page.locator('#sd-title')).toHaveText('О проекте'); // раздел открыт прежний

    // у заголовка — логотип приложения
    await nav(page).last().click();
    await expect(page.locator('#sd-title')).toHaveText('Экспериментальные');
    await expect(page.locator('#sd-title .sd-head-icon img')).toHaveAttribute('src', 'logo.svg');
    // «Показывать на превью видимую область» переехала сюда из настроек доски
    await expect(page.locator('#settings-dialog label', { hasText: 'Показывать на превью видимую область' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-popover')).not.toContainText('видимую область');
    await page.keyboard.press('Escape');

    await page.reload();
    await board.ready();
    await openSection(page, 'experimental');
    await page.locator('.sd-exp-hide').click();
    await expect(nav(page)).toHaveCount(4);
    await expect(page.locator('#sd-title')).toHaveText('Доска');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Comma');
    await expect(nav(page)).toHaveCount(4);
  });

  test('цвета иконки: выбор показывается у заголовка, «Сохранить» меняет иконку приложения, «Сбросить» — обратно', async ({ board, page }) => {
    await unlock(page);
    await openSection(page, 'experimental');
    const head = page.locator('#sd-title .sd-head-icon img');
    const save = page.locator('.sd-exp-save');
    const reset = page.locator('.sd-exp-reset');
    const main = page.locator('.sd-exp-color[data-color="main"] .sd-exp-swatch');
    await expect(main).toHaveText('#315b3c');
    await expect(page.locator('.sd-exp-color[data-color="accent"] .sd-exp-swatch')).toHaveText('#a8600a');
    await expect(save).toBeDisabled();
    await expect(reset).toBeDisabled();

    await main.click();
    const hex = page.locator('.sd-exp-picker .picker-hex input');
    await expect(hex).toBeVisible();
    await hex.fill('#7a2bd6');
    await hex.dispatchEvent('change');
    await expect(main).toHaveText('#7a2bd6');
    // пока не сохранили — меняется только картинка у заголовка
    await expect(head).toHaveAttribute('src', /%237a2bd6/);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'logo.svg');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(save).toBeDisabled();
    await expect(reset).toBeEnabled();
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^data:image\/svg\+xml.*%237a2bd6/);
    await openSection(page, 'about');
    await expect(page.locator('.sd-about-logo')).toHaveAttribute('src', /%237a2bd6/);

    // после перезапуска — свои цвета
    await page.reload();
    await board.ready();
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /%237a2bd6/);
    await openSection(page, 'experimental');
    await expect(main).toHaveText('#7a2bd6');
    await reset.click();
    await expect(main).toHaveText('#315b3c');
    await expect(reset).toBeDisabled();
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'logo.svg');
    await expect(head).toHaveAttribute('src', 'logo.svg');
    expect(await page.evaluate(() => localStorage.getItem('doska.iconColors'))).toBeNull();
  });
});

hostTest('приложение для компьютера: свои цвета — и иконка окна', async ({ host, page }) => {
  await page.evaluate(() => localStorage.setItem('doska.experiments', '1'));
  await openSection(page, 'experimental');
  await page.locator('.sd-exp-color[data-color="accent"] .sd-exp-swatch').click();
  const hex = page.locator('.sd-exp-picker .picker-hex input');
  await hex.fill('#00aa55');
  await hex.dispatchEvent('change');
  await page.locator('.sd-exp-save').click();
  await expect.poll(() => host.icons.length).toBe(1);
  expect(host.icons[0]).toMatch(/^data:image\/png;base64,/);
});

// ----- Страницы на холсте -----

/** Две страницы: на второй — прямоугольник; открыта первая. */
async function twoPages(board: Board): Promise<string> {
  await board.addPage();
  await board.rect(300, 200, 700, 500);
  const second = (await board.state()).pageId;
  await board.page.locator('#pages-list .page-item').first().click();
  await expect.poll(async () => (await board.state()).pageId).not.toBe(second);
  return second;
}

/** Тянет карточку страницы из списка в точку окна (x, y). */
async function dragCard(page: Page, index: number, x: number, y: number): Promise<void> {
  const c = (await page.locator('#pages-list .page-item').nth(index).boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 3);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2, c.y - 30, { steps: 4 });
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
}

async function enablePageLinks(page: Page): Promise<void> {
  await unlock(page);
  await openSection(page, 'experimental');
  await page.locator('#settings-dialog label', { hasText: 'Страницы на холсте' }).locator('input').check();
  await page.keyboard.press('Escape');
}

test.describe('страницы на холсте', () => {
  test('без настройки карточку на холст не вынести; с ней — превью страницы там, где отпустили', async ({ board, page }) => {
    const second = await twoPages(board);
    const box = (await board.canvas.boundingBox())!;
    await dragCard(page, 1, box.x + 700, box.y + 250);
    expect(await board.count()).toBe(0);
    expect((await board.state()).project.pages.map(p => p.name)).toEqual(['Страница 1', 'Страница 2']);

    await enablePageLinks(page);
    expect((await board.state()).settings.pageLinks).toBe(true);
    // пока тащат за пределами списка — за указателем едет превью, карточка ждёт на месте
    const c = (await page.locator('#pages-list .page-item').nth(1).boundingBox())!;
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 3);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width / 2, c.y - 30, { steps: 4 });
    await page.mouse.move(box.x + 700, box.y + 250, { steps: 10 });
    await expect(page.locator('.drag-ghost canvas')).toBeVisible();
    await expect(page.locator('#pages-list .page-item').nth(1)).toHaveClass(/drag-out/);
    await page.mouse.up();
    await expect(page.locator('.drag-ghost')).toHaveCount(0);

    const [link] = await board.elements();
    expect(link).toMatchObject({ type: 'image', page: second, src: '' });
    expect(link.color).toBeTruthy();
    // по центру точки отпускания, с соотношением сторон холста
    const center = await board.screen({ x: link.x + link.w / 2, y: link.y + link.h / 2 });
    expect(center.x).toBeCloseTo(box.x + 700, 0);
    expect(center.y).toBeCloseTo(box.y + 250, 0);
    expect(link.w / link.h).toBeCloseTo(box.width / box.height, 2);
    const s = await board.state();
    expect(s.selection).toEqual([link.id]);
    expect(s.tool).toBe('select');
    expect(s.project.pages.map(p => p.name)).toEqual(['Страница 1', 'Страница 2']); // порядок страниц прежний

    // мимо холста (на панель инструментов) — ничего; открытую страницу — нельзя
    const tb = (await page.locator('#toolbar').boundingBox())!;
    await dragCard(page, 1, tb.x + tb.width / 2, tb.y + 40);
    await dragCard(page, 0, box.x + 300, box.y + 600);
    await expect(page.locator('#toast')).toHaveText('Это открытая страница — на холст можно положить другую');
    expect(await board.count()).toBe(1);
  });

  test('клик по превью — приближение и переход на страницу, ввод на это время заблокирован; перенос — не переход', async ({ board, page }) => {
    const second = await twoPages(board);
    await enablePageLinks(page);
    const box = (await board.canvas.boundingBox())!;
    await dragCard(page, 1, box.x + 900, box.y + 250);
    const [link] = await board.elements();
    const first = (await board.state()).pageId;

    // у превью — ручки размера, но не поворота; перенос двигает и не открывает страницу
    await page.keyboard.press('Escape');
    const at = await board.screen({ x: link.x + link.w / 2, y: link.y + link.h / 2 });
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x - 200, at.y + 100, { steps: 6 });
    await page.mouse.up();
    const moved = (await board.elements())[0];
    expect(moved.x).toBeCloseTo(link.x - 200 / (await board.state()).camera.zoom, 0);
    expect((await board.state()).pageId).toBe(first);
    expect(await page.evaluate(() => {
      const w = window as any;
      return w.__doska.state.selection.size;
    })).toBe(1);

    // клик — переход: пока идёт, щит над окном, клавиши не работают
    const zoom0 = (await board.state()).camera.zoom;
    const c = await board.screen({ x: moved.x + moved.w / 2, y: moved.y + moved.h / 2 });
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('#input-lock')).toHaveCount(1);
    await page.keyboard.press('r');
    await page.keyboard.press('Delete');
    await expect(page.locator('#input-lock')).toHaveCount(0, { timeout: 5000 });
    const s = await board.state();
    expect(s.pageId).toBe(second);
    expect(s.tool).toBe('select');
    expect(s.selection).toEqual([]);
    expect(s.camera.zoom).not.toBe(zoom0);
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');
    // на первой странице превью осталось
    expect(s.project.pages.find(p => p.id === first)!.count).toBe(1);
    // открытая страница лежит там, где была в превью: прямоугольник на экране — на месте внутренней картинки
    const r = (await board.elements())[0];
    const tl = await board.screen({ x: r.x, y: r.y });
    const br = await board.screen({ x: r.x + r.w, y: r.y + r.h });
    expect((tl.x + br.x) / 2).toBeCloseTo(box.x + box.width / 2, -1);
    expect((tl.y + br.y) / 2).toBeCloseTo(box.y + box.height / 2, -1);
  });
});
