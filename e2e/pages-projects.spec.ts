import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Ответ на следующий confirm(). */
function onConfirm(page: Page, accept: boolean): Promise<string> {
  return new Promise(resolve => page.once('dialog', d => {
    resolve(d.message());
    void (accept ? d.accept() : d.dismiss());
  }));
}

/** Перетаскивает карточку мышью на место другой (по шагам — как рука). */
async function dragOnto(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3, { steps: 12 });
  await page.mouse.up();
}

/** Считает слои анимации перехода, появившиеся над холстом (в основном окне или окне демонстрации). */
async function countTransitions(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as any;
    w.__transitions = 0;
    const host = document.getElementById('canvas-wrap') ?? document.body;
    new MutationObserver(ms => {
      for (const m of ms) for (const n of m.addedNodes) if ((n as HTMLElement).classList?.contains('page-transition')) w.__transitions++;
    }).observe(host, { childList: true });
  });
  return () => page.evaluate(() => (window as any).__transitions as number);
}

test.describe('страницы проекта', () => {
  test('плавающая кнопка: «Страница +» добавляет страницу, «Страницы» поднимается над списком', async ({ board, page }) => {
    const btn = page.locator('#btn-pages');
    const tray = page.locator('#pages-tray');
    const wrap = (await page.locator('#canvas-wrap').boundingBox())!;
    // слева внизу, страница пока одна
    await expect(btn).toHaveText('Страница');
    await expect(tray).toBeHidden();
    const down = (await btn.boundingBox())!;
    expect(down.x - wrap.x).toBeLessThan(20);
    expect(wrap.y + wrap.height - (down.y + down.height)).toBeLessThan(20);

    await btn.click();
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');
    await expect(tray).toBeVisible();
    await expect(btn).toHaveText('Страницы 2');
    await expect(page.locator('#pages-list .page-item')).toHaveCount(2);
    await expect(page.locator('#pages-list .page-item').nth(1)).toHaveClass(/active/);
    // курсор остался там, где была кнопка, — над первой карточкой; уводим, чтобы она не была приподнята
    await page.mouse.move(wrap.x + wrap.width / 2, wrap.y + 100);
    await board.settled();

    // кнопка приподнялась, список — прямо под ней
    const up = (await btn.boundingBox())!;
    expect(up.x).toBeCloseTo(down.x, 0);
    expect(up.y).toBeLessThan(down.y - 100);
    const cards = page.locator('#pages-list .page-item');
    const first = (await cards.first().boundingBox())!;
    expect(first.y).toBeGreaterThan(up.y + up.height);
    expect(first.x).toBeCloseTo(up.x, 0);
    // карточки идут в ряд, у каждой — превью и название
    const second = (await cards.nth(1).boundingBox())!;
    expect(second.y).toBeCloseTo(first.y, 0);
    expect(second.x).toBeGreaterThan(first.x + first.width);
    await expect(cards.locator('canvas')).toHaveCount(2);
    await expect(cards.locator('.page-name')).toHaveText(['Страница 1', 'Страница 2']);
    // подложки нет: у самого списка прозрачный фон
    expect(await page.locator('#pages-list').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await tray.evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');

    // последний элемент — такая же по размеру плитка с пунктиром и «+»
    const add = page.locator('#pages-list > :last-child');
    await expect(add).toHaveClass('page-add');
    const ab = (await add.boundingBox())!;
    expect(ab.width).toBeCloseTo(first.width, 0);
    expect(ab.height).toBeCloseTo(first.height, 0);
    expect(await add.evaluate(e => getComputedStyle(e).borderStyle)).toBe('dashed');

    // повторный клик — список скрывается, кнопка опускается на место
    await btn.click();
    await expect(tray).toBeHidden();
    await board.settled();
    expect((await btn.boundingBox())!.y).toBeCloseTo(down.y, 0);
    await expect(btn).toHaveText('Страницы 2');
    // и снова показывает список, ничего не добавляя
    await btn.click();
    await expect(tray).toBeVisible();
    expect((await board.state()).project.pages).toHaveLength(2);
  });

  test('клавиша B показывает и скрывает список', async ({ board, page }) => {
    const tray = page.locator('#pages-tray');
    await board.tool('b');
    await expect(tray).toBeVisible();
    await expect(page.locator('#pages-list .page-item')).toHaveCount(1);
    await expect(page.locator('#pages-list .page-add')).toBeVisible();
    await expect(page.locator('#btn-pages')).toHaveText('Страницы 1');
    await board.tool('b');
    await expect(tray).toBeHidden();
    await expect(page.locator('#btn-pages')).toHaveText('Страница');
    expect((await board.state()).project.pages).toHaveLength(1);
  });

  test('новая страница, переключение и независимое содержимое', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await board.addPage();
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
    await expect(page.locator('#pages-list .page-num')).toHaveText(['1', '2']);
  });

  test('превью страниц показывают их содержимое', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await board.addPage();
    await board.settled();
    // доля тёмных пикселей на превью: у страницы с прямоугольником они есть, у пустой — нет
    const ink = (i: number) => page.locator('#pages-list .page-item canvas').nth(i).evaluate(c => {
      const cv = c as HTMLCanvasElement;
      const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let k = 0; k < d.length; k += 4) if (d[k] < 80 && d[k + 1] < 80 && d[k + 2] < 80) n++;
      return n;
    });
    expect(await ink(0)).toBeGreaterThan(100);
    expect(await ink(1)).toBe(0);
    // рисунок на открытой странице сразу попадает в её превью
    await board.rect(0, 0, 200, 120);
    await expect.poll(() => ink(1)).toBeGreaterThan(100);
  });

  test('переименование страницы двойным кликом', async ({ board, page }) => {
    await board.openPages();
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
    await expect(page.locator('#pages-list input')).toHaveCount(0);
    await expect(page.locator('#pages-list .page-name')).toHaveText(['Дроби']);
    expect((await board.state()).project.pages[0].name).toBe('Дроби');

    // правки после переименования попадают в проект и сохраняются
    await board.rect(400, 300, 500, 400);
    await board.saved();
    await page.reload();
    await board.ready();
    expect((await board.state()).project.pages[0]).toMatchObject({ name: 'Дроби', count: 1 });
  });

  test('переименование неактивной страницы', async ({ board, page }) => {
    await board.addPage();
    const first = page.locator('#pages-list .page-item').first();
    await first.locator('.page-name').dblclick();
    await page.locator('#pages-list input').fill('Разминка');
    await page.locator('#pages-list input').press('Enter');
    await expect(page.locator('#pages-list .page-name')).toHaveText(['Разминка', 'Страница 2']);
    expect((await board.state()).project.pages.map(p => p.name)).toEqual(['Разминка', 'Страница 2']);
  });

  test('удаление страницы с подтверждением', async ({ board, page }) => {
    await board.addPage();
    await expect(page.locator('#pages-list .page-item')).toHaveCount(2);
    const first = page.locator('#pages-list .page-item').first();
    const del = first.locator('.page-del');

    // кнопка удаления появляется при наведении
    await expect(del).toBeHidden();
    await first.hover();
    await expect(del).toBeVisible();
    let msg = onConfirm(page, false);
    await del.click();
    expect(await msg).toBe('Удалить страницу «Страница 1»?');
    await expect(page.locator('#pages-list .page-item')).toHaveCount(2);

    msg = onConfirm(page, true);
    await first.hover();
    await del.click();
    await msg;
    await expect(page.locator('#pages-list .page-name')).toHaveText(['Страница 2']);
    await expect(page.locator('#btn-pages')).toHaveText('Страницы 1'); // список открыт

    // последняя страница заменяется пустой
    msg = onConfirm(page, true);
    await page.locator('#pages-list .page-item').hover();
    await page.locator('#pages-list .page-del').click();
    await msg;
    await expect(page.locator('#pages-list .page-name')).toHaveText(['Страница 1']);
    expect((await board.state()).project.pages).toHaveLength(1);
  });

  test('много страниц: список прокручивается колёсиком', async ({ board, page }) => {
    for (let i = 0; i < 9; i++) await board.addPage();
    const list = page.locator('#pages-list');
    await board.settled();
    const { scrollWidth, clientWidth } = await list.evaluate(e => ({ scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    // активная (последняя) страница прокручена в видимую часть
    const wrap = (await page.locator('#canvas-wrap').boundingBox())!;
    const active = (await page.locator('#pages-list .page-item.active').boundingBox())!;
    expect(active.x + active.width).toBeLessThanOrEqual(wrap.x + wrap.width);
    // обычное колёсико листает список по горизонтали
    await list.evaluate(e => { e.scrollLeft = 0; });
    const b = (await list.boundingBox())!;
    await page.mouse.move(b.x + 100, b.y + b.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => list.evaluate(e => e.scrollLeft)).toBeGreaterThan(0);
  });

  test('анимация перехода на другую страницу из настроек', async ({ board, page }) => {
    const transitions = await countTransitions(page);
    const layer = page.locator('#canvas-wrap > .page-transition');
    // разное содержимое — чтобы переход было видно
    await board.rect(400, 300, 700, 500);
    // по умолчанию — слайд
    expect((await board.state()).settings.pageTransition).toBe('slide');
    await page.locator('#btn-pages').click();
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');
    await expect.poll(transitions).toBe(1);
    await expect(layer).toHaveCount(0); // слой перехода убирается после анимации
    await board.tool('p');
    await board.drag([{ x: -300, y: 100 }, { x: -100, y: -120 }, { x: 100, y: 100 }, { x: 300, y: -120 }]);

    const cards = page.locator('#pages-list .page-item');
    const pick = async (name: string) => {
      await page.locator('#btn-settings').click();
      await page.locator('#settings-popover .ctx-options button', { hasText: name }).click();
      await expect(page.locator('#settings-popover .ctx-options button', { hasText: name })).toHaveClass(/active/);
      await page.locator('#btn-settings').click();
    };
    await expect(page.locator('#settings-popover')).toBeHidden();
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-popover .ctx-label', { hasText: 'Анимация перехода на другую страницу' })).toBeVisible();
    await expect(page.locator('#settings-popover .ctx-options button')).toHaveText(['Нет', 'Слайд', 'Затухание', 'Приближение']);
    await page.locator('#btn-settings').click();

    let expected = 1;
    for (const [name, mode] of [['Затухание', 'fade'], ['Приближение', 'zoom'], ['Слайд', 'slide']]) {
      await pick(name);
      expect((await board.state()).settings.pageTransition).toBe(mode);
      await cards.nth(expected % 2 === 1 ? 0 : 1).click();
      await expect.poll(transitions).toBe(++expected);
      await expect(layer).toHaveCount(0);
    }

    // «Нет» — страница сменяется без анимации
    await pick('Нет');
    const before = await transitions();
    await cards.first().click();
    await cards.nth(1).click();
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');
    expect(await transitions()).toBe(before);

    // выбор сохраняется
    await page.reload();
    await board.ready();
    expect((await board.state()).settings.pageTransition).toBe('none');
  });

  test('во время перехода холст не сдвигается: можно сразу рисовать', async ({ board, page }) => {
    await board.addPage();
    await page.locator('#pages-list .page-item').first().click();
    // рисуем, пока идёт слайд: координаты не съезжают
    await board.rect(100, 100, 300, 200);
    const r = (await board.elements())[0];
    expect(r.type).toBe('shape');
    for (const [k, v] of [['x', 100], ['y', 100], ['w', 200], ['h', 100]] as const) expect(r[k]).toBeCloseTo(v, 0);
    expect(await board.canvas.evaluate(e => getComputedStyle(e).transform)).toBe('none');
  });

  test('страницы и их содержимое сохраняются между запусками', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await board.addPage();
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

  test('страницы в списке переставляются перетаскиванием', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await board.addPage();
    await board.addPage();
    await board.settled();
    const cards = page.locator('#pages-list .page-item');
    await expect(cards.locator('.page-name')).toHaveText(['Страница 1', 'Страница 2', 'Страница 3']);
    const active = (await board.state()).pageId;

    await dragOnto(page, cards.first(), cards.nth(2));
    await expect(cards.locator('.page-name')).toHaveText(['Страница 2', 'Страница 3', 'Страница 1']);
    await expect(page.locator('#pages-list .page-num')).toHaveText(['1', '2', '3']);
    const s = await board.state();
    expect(s.project.pages.map(p => p.name)).toEqual(['Страница 2', 'Страница 3', 'Страница 1']);
    // перетаскивание — не клик: активная страница та же, переходов не было
    expect(s.pageId).toBe(active);
    expect(s.project.pages[2].count).toBe(1);
    await board.saved();

    // порядок пережил перезагрузку
    await page.reload();
    await board.ready();
    expect((await board.state()).project.pages.map(p => p.name)).toEqual(['Страница 2', 'Страница 3', 'Страница 1']);
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
    await expect(page.locator('#project-name')).toHaveText('Алгебра 7Б');
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
    await card.locator('.home-page input').fill('Введение');
    await card.locator('.home-page input').press('Enter');
    await expect(card.locator('.home-page-name')).toHaveText(['Введение', 'Страница 2']);

    const msg = onConfirm(page, true);
    await card.locator('.home-page').nth(1).hover();
    await card.locator('.home-page').nth(1).locator('.page-del').click();
    await msg;
    await expect(card.locator('.home-page-name')).toHaveText(['Введение']);

    await card.locator('.home-page').first().click();
    await expect(page.locator('#home')).toBeHidden();
    await expect(page.locator('#page-name')).toHaveValue('Введение');
  });

  test('добавление страницы в неоткрытый проект', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    const other = page.locator('#home .project-card').nth(1);
    // страницы неоткрытого проекта видны с превью
    await expect(other.locator('.home-page canvas')).toHaveCount(1);
    await other.locator('.home-add-page').click();
    await expect(other.locator('.project-info')).toContainText('Страниц: 2');
    await expect(other.locator('.home-page-name')).toHaveText(['Страница 1', 'Страница 2']);
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

  test('на карточке проекта — превью страниц', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await board.addPage();
    await page.locator('#btn-home').click();
    const card = page.locator('#home .project-card');
    const tiles = card.locator('.home-page');
    await expect(tiles).toHaveCount(2);
    await expect(tiles.locator('canvas')).toHaveCount(2);
    await expect(tiles.locator('.page-num')).toHaveText(['1', '2']);
    await expect(tiles.nth(1)).toHaveClass(/active/);
    // превью первой страницы с прямоугольником отличается от пустой второй
    const shots = await tiles.locator('canvas').evaluateAll(cs => cs.map(c => (c as HTMLCanvasElement).toDataURL()));
    expect(shots[0]).not.toBe(shots[1]);
    // клик по превью открывает страницу
    await tiles.first().click();
    await expect(page.locator('#home')).toBeHidden();
    await expect(page.locator('#page-name')).toHaveValue('Страница 1');
  });

  test('страницы переставляются перетаскиванием на домашней', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    const card = page.locator('#home .project-card');
    await card.locator('.home-add-page').click();
    await card.locator('.home-add-page').click();
    const names = card.locator('.home-page-name');
    await expect(names).toHaveText(['Страница 1', 'Страница 2', 'Страница 3']);

    await dragOnto(page, card.locator('.home-page').nth(2), card.locator('.home-page').first());
    await expect(names).toHaveText(['Страница 3', 'Страница 1', 'Страница 2']);
    await expect(card.locator('.page-num')).toHaveText(['1', '2', '3']);
    await expect(page.locator('#home')).toBeVisible(); // перетаскивание не открыло страницу
    expect((await board.state()).project.pages.map(p => p.name)).toEqual(['Страница 3', 'Страница 1', 'Страница 2']);

    // и в неоткрытом проекте
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    const other = page.locator('#home .project-card').nth(1);
    await dragOnto(page, other.locator('.home-page').first(), other.locator('.home-page').nth(1));
    await expect(other.locator('.home-page-name')).toHaveText(['Страница 1', 'Страница 3', 'Страница 2']);
    await other.locator('.project-open').click();
    expect((await board.state()).project.pages.map(p => p.name)).toEqual(['Страница 1', 'Страница 3', 'Страница 2']);
  });

  test('закрепление проектов в избранном', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    const home = page.locator('#home');
    await expect(home.locator('.home-section-title')).toHaveCount(0); // пока избранного нет — без разделов
    await expect(home.locator('.project-name')).toHaveText(['Проект 2', 'Проект 1']);

    // закрепляем неоткрытый проект: он уходит наверх, в «Избранное»
    const pin = home.locator('.project-card').nth(1).locator('.project-pin');
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    await pin.click();
    await expect(home.locator('.home-section-title')).toHaveText(['Избранное', 'Остальные проекты']);
    const fav = home.locator('.home-section').first();
    await expect(fav.locator('.project-name')).toHaveText(['Проект 1']);
    await expect(fav.locator('.project-pin')).toHaveAttribute('aria-pressed', 'true');
    await expect(fav.locator('.new-project')).toHaveCount(0);
    await expect(home.locator('.home-section').nth(1).locator('.project-name')).toHaveText(['Проект 2']);

    // и открытый тоже
    await home.locator('.home-section').nth(1).locator('.project-pin').click();
    await expect(fav.locator('.project-name')).toHaveText(['Проект 2', 'Проект 1']);
    await expect(home.locator('.home-section').nth(1).locator('.project-card')).toHaveCount(0);
    await expect(home.locator('.new-project')).toBeVisible();

    // избранное переживает перезагрузку
    await page.reload();
    await board.ready();
    await page.locator('#btn-home').click();
    await expect(home.locator('.home-section').first().locator('.project-name')).toHaveText(['Проект 2', 'Проект 1']);

    // открепляем
    await home.locator('.project-card', { hasText: 'Проект 1' }).locator('.project-pin').click();
    await expect(home.locator('.home-section').first().locator('.project-name')).toHaveText(['Проект 2']);
    await home.locator('.project-card', { hasText: 'Проект 2' }).locator('.project-pin').click();
    await expect(home.locator('.home-section-title')).toHaveCount(0);
    await expect(home.locator('.project-card')).toHaveCount(2);
  });
});
