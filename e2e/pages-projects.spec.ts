import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Ответ на следующий confirm(). */
function onConfirm(page: Page, accept: boolean): Promise<string> {
  return new Promise(resolve => page.once('dialog', d => {
    resolve(d.message());
    void (accept ? d.accept() : d.dismiss());
  }));
}

test.describe('страницы проекта', () => {
  test('боковая панель открывается кнопкой и клавишей B', async ({ board, page }) => {
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toBeVisible();
    await page.locator('#btn-sidebar').click();
    await expect(sidebar).toBeHidden();
    await board.tool('b');
    await expect(sidebar).toBeVisible();
  });

  test('новая страница, переключение и независимое содержимое', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await page.locator('#btn-new-page').click();
    await expect(page.locator('#pages-list .page-item')).toHaveCount(2);
    await expect(page.locator('#pages-list .page-item').nth(1)).toHaveClass(/active/);
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');
    expect(await board.count()).toBe(0);
    await expect(page.locator('#btn-undo')).toBeDisabled(); // у страницы своя история

    await board.tool('p');
    await board.drag([{ x: 400, y: 300 }, { x: 500, y: 300 }]);
    await page.locator('#pages-list .page-item').first().click();
    await expect(page.locator('#page-name')).toHaveValue('Страница 1');
    expect((await board.elements()).map(e => e.type)).toEqual(['shape']);
    await page.locator('#pages-list .page-item').nth(1).click();
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');
    expect((await board.elements()).map(e => e.type)).toEqual(['stroke']);
    // превью страницы — непустой канвас
    await expect(page.locator('#pages-list .page-item canvas')).toHaveCount(2);
  });

  test('переименование страницы двойным кликом', async ({ board, page }) => {
    await page.locator('#pages-list .page-name').dblclick();
    const input = page.locator('#pages-list input');
    await expect(input).toBeFocused();
    await input.fill('Дроби');
    await input.press('Enter');
    await expect(page.locator('#pages-list .page-name')).toHaveText(['Дроби']);
    await expect(page.locator('#page-name')).toHaveValue('Дроби');
    // Esc отменяет переименование
    await page.locator('#pages-list .page-name').dblclick();
    await page.locator('#pages-list input').fill('Не то');
    await page.locator('#pages-list input').press('Escape');
    await expect(page.locator('#pages-list .page-name')).toHaveText(['Дроби']);
    expect((await board.state()).project.pages[0].name).toBe('Дроби');

    // правки после переименования попадают в проект и сохраняются
    await board.rect(400, 300, 500, 400);
    await board.saved();
    await page.reload();
    await board.ready();
    expect((await board.state()).project.pages[0]).toMatchObject({ name: 'Дроби', count: 1 });
  });

  test('удаление страницы с подтверждением', async ({ board, page }) => {
    await page.locator('#btn-new-page').click();
    await expect(page.locator('#pages-list .page-item')).toHaveCount(2);
    const first = page.locator('#pages-list .page-item').first();
    const del = first.locator('.page-del');

    // кнопка удаления появляется при наведении
    await expect(del).toBeHidden();
    await first.hover();
    let msg = onConfirm(page, false);
    await del.click();
    expect(await msg).toBe('Удалить страницу «Страница 1»?');
    await expect(page.locator('#pages-list .page-item')).toHaveCount(2);

    msg = onConfirm(page, true);
    await first.hover();
    await del.click();
    await msg;
    await expect(page.locator('#pages-list .page-name')).toHaveText(['Страница 2']);

    // последняя страница заменяется пустой
    msg = onConfirm(page, true);
    await page.locator('#pages-list .page-item').hover();
    await page.locator('#pages-list .page-del').click();
    await msg;
    await expect(page.locator('#pages-list .page-name')).toHaveText(['Страница 1']);
    expect((await board.state()).project.pages).toHaveLength(1);
  });

  test('страницы и их содержимое сохраняются между запусками', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await page.locator('#btn-new-page').click();
    await page.locator('#grid-mode').selectOption('coord');
    await board.tool('p');
    await board.drag([{ x: 400, y: 300 }, { x: 500, y: 300 }]);
    await board.saved();
    await page.reload();
    await board.ready();
    const s = await board.state();
    expect(s.project.pages.map(p => [p.name, p.grid, p.count])).toEqual([
      ['Страница 1', 'square', 1],
      ['Страница 2', 'coord', 1],
    ]);
    expect(s.pageId).toBe(s.project.pages[1].id); // открыта последняя страница
  });

  test('Ctrl+S сохраняет сразу', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await page.keyboard.press('Control+s');
    await board.saved();
    const stored = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('doska.p.')).length);
    expect(stored).toBe(1);
  });
});

test.describe('домашняя страница: проекты', () => {
  test('переход на домашнюю и обратно', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    const home = page.locator('#home');
    await expect(home).toBeVisible();
    await expect(home.locator('h1')).toHaveText('Проекты');
    await expect(home.locator('.project-card')).toHaveCount(1);
    await expect(home.locator('.project-name')).toHaveText('Проект 1');
    await expect(home.locator('.project-info')).toContainText('Страниц: 1');
    expect((await board.state()).view).toBe('home');
    await page.locator('#btn-home').click();
    await expect(home).toBeHidden();
  });

  test('новый проект открывается на доске, старый остаётся в списке', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await expect(page.locator('#home')).toBeHidden();
    const s = await board.state();
    expect(s.project.name).toBe('Проект 2');
    expect(await board.count()).toBe(0);
    await page.locator('#btn-home').click();
    await expect(page.locator('#home .project-name')).toHaveText(['Проект 2', 'Проект 1']);

    // открыть первый проект — его содержимое на месте
    await page.locator('#home .project-card').nth(1).locator('.project-open').click();
    expect((await board.state()).project.name).toBe('Проект 1');
    expect(await board.count()).toBe(1);
  });

  test('переименование проекта', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    await page.locator('#home .project-name').dblclick();
    const input = page.locator('#home .project-title input');
    await input.fill('Алгебра 7Б');
    await input.press('Enter');
    await expect(page.locator('#home .project-name')).toHaveText('Алгебра 7Б');
    await expect(page.locator('#sidebar-project')).toHaveText('Алгебра 7Б');
    expect((await board.state()).project.name).toBe('Алгебра 7Б');
    await page.reload();
    await board.ready();
    expect((await board.state()).project.name).toBe('Алгебра 7Б');
  });

  test('переименование неоткрытого проекта', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    const other = page.locator('#home .project-card').nth(1);
    await other.locator('.project-name').dblclick();
    await other.locator('input').fill('Геометрия');
    await other.locator('input').press('Enter');
    await expect(page.locator('#home .project-name')).toHaveText(['Проект 2', 'Геометрия']);
    await page.locator('#home .project-card').nth(1).locator('.project-open').click();
    expect((await board.state()).project.name).toBe('Геометрия');
  });

  test('удаление проектов', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    await expect(page.locator('#home .project-card')).toHaveCount(2);

    let msg = onConfirm(page, false);
    await page.locator('#home .project-card').first().locator('.project-title .icon').click();
    expect(await msg).toBe('Удалить проект «Проект 2» со всеми страницами?');
    await expect(page.locator('#home .project-card')).toHaveCount(2);

    // удаление открытого проекта открывает следующий
    msg = onConfirm(page, true);
    await page.locator('#home .project-card').first().locator('.project-title .icon').click();
    await msg;
    await expect(page.locator('#home .project-name')).toHaveText(['Проект 1']);
    await expect(page.locator('#home')).toBeVisible(); // остаёмся в списке проектов
    expect((await board.state()).project.name).toBe('Проект 1');

    // удаление последнего создаёт пустой
    msg = onConfirm(page, true);
    await page.locator('#home .project-title .icon').click();
    await msg;
    await expect(page.locator('#home .project-card')).toHaveCount(1);
    const s = await board.state();
    expect(s.project.pages).toHaveLength(1);
    expect(s.projects).toHaveLength(1);
  });

  test('страницы открытого проекта на домашней странице', async ({ page }) => {
    await page.locator('#btn-home').click();
    const card = page.locator('#home .project-card');
    await card.locator('.home-add-page').click();
    await expect(card.locator('.home-page-name')).toHaveText(['Страница 1', 'Страница 2']);
    await expect(card.locator('.project-info')).toContainText('Страниц: 2');

    await card.locator('.home-page-name').first().dblclick();
    await card.locator('.home-page-row input').fill('Введение');
    await card.locator('.home-page-row input').press('Enter');
    await expect(card.locator('.home-page-name')).toHaveText(['Введение', 'Страница 2']);

    const msg = onConfirm(page, true);
    await card.locator('.home-page-row').nth(1).hover();
    await card.locator('.home-page-row').nth(1).locator('.page-del').click();
    await msg;
    await expect(card.locator('.home-page-name')).toHaveText(['Введение']);

    await card.locator('.home-page-row').first().click();
    await expect(page.locator('#home')).toBeHidden();
    await expect(page.locator('#page-name')).toHaveValue('Введение');
  });

  test('добавление страницы в неоткрытый проект', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    const other = page.locator('#home .project-card').nth(1);
    await expect(other.locator('.home-pages-hint')).toBeVisible();
    await other.locator('.home-add-page').click();
    await expect(other.locator('.project-info')).toContainText('Страниц: 2');
    await other.locator('.project-open').click();
    expect((await board.state()).project.pages.map(p => p.name)).toEqual(['Страница 1', 'Страница 2']);
  });

  test('список проектов переживает перезагрузку', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.reload();
    await board.ready();
    const s = await board.state();
    expect(s.projects.map(p => p.name).sort()).toEqual(['Проект 1', 'Проект 2', 'Проект 3']);
    expect(s.project.name).toBe('Проект 3');
  });
});
