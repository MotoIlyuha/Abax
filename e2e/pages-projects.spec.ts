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
    // рисунок на открытой странице сразу попадает в её превью (оно вписывает ещё и видимую область — мельче)
    await board.rect(0, 0, 200, 120);
    await expect.poll(() => ink(1)).toBeGreaterThan(30);
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

  test('панель инструментов внизу: кнопка страниц слева вверху, список колонкой, кнопка не двигается', async ({ board, page }) => {
    await page.locator('#btn-settings').click();
    await page.locator('#settings-popover button', { hasText: 'Снизу' }).click();
    await page.locator('#btn-settings').click();
    const dock = page.locator('#pages-dock');
    await expect(dock).toHaveAttribute('data-side', 'top');
    for (let i = 0; i < 6; i++) await board.addPage();
    await board.openPages();
    await board.settled();

    const wrap = (await page.locator('#canvas-wrap').boundingBox())!;
    const btn = page.locator('#btn-pages');
    const closedBox = await (async () => {
      await board.tool('b');
      await expect(page.locator('#pages-tray')).toBeHidden();
      return (await btn.boundingBox())!;
    })();
    expect(closedBox.y - wrap.y).toBeLessThan(20);
    expect(closedBox.x - wrap.x).toBeLessThan(20);
    // у кнопки нет перехода: при открытии она стоит на месте с первого кадра
    expect(await btn.evaluate(e => getComputedStyle(e).transitionDuration)).toBe('0s');
    await board.tool('b');
    expect(await btn.evaluate(e => e.getAnimations().length)).toBe(0);
    expect((await btn.boundingBox())!.y).toBe(closedBox.y);

    // длинный список прокручивается внутри холста; активная (последняя) страница прокручена в видимую часть
    await board.settled();
    const list = page.locator('#pages-list');
    const { sh, ch } = await list.evaluate(e => ({ sh: e.scrollHeight, ch: e.clientHeight }));
    expect(sh).toBeGreaterThan(ch);
    const tray = (await page.locator('#pages-tray').boundingBox())!;
    expect(tray.y + tray.height).toBeLessThanOrEqual(wrap.y + wrap.height);
    const active = (await page.locator('#pages-list .page-item.active').boundingBox())!;
    expect(active.y + active.height).toBeLessThanOrEqual(wrap.y + wrap.height);
    expect(active.y).toBeGreaterThan(closedBox.y + closedBox.height);

    // карточки — колонкой под кнопкой
    await list.evaluate(e => { e.scrollTop = 0; });
    const cards = page.locator('#pages-list .page-item');
    const first = (await cards.nth(0).boundingBox())!;
    const second = (await cards.nth(1).boundingBox())!;
    expect(first.y).toBeGreaterThan(closedBox.y + closedBox.height);
    expect(second.x).toBeCloseTo(first.x, 0);
    expect(second.y).toBeGreaterThan(first.y + first.height);

    // панель обратно влево — кнопка снова внизу
    await page.locator('#btn-settings').click();
    await page.locator('#settings-popover button', { hasText: 'Слева' }).click();
    await expect(dock).toHaveAttribute('data-side', 'bottom');
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
    await board.grid('coord');
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

  test('уход в фон сохраняет сразу, не дожидаясь таймера', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    const dirtyAfterHide = await page.evaluate(() => {
      const s = (window as any).__doska.state;
      s.dirty = true; // несохранённое изменение, таймер автосохранения ещё не сработал
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      return s.dirty;
    });
    expect(dirtyAfterHide).toBe(false);
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
    await expect(home.locator('.project-info')).toHaveText('1 страница · изменён сегодня');
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

    // открыть первый проект кликом по карточке — его содержимое на месте
    await page.locator('#home .project-card').nth(1).locator('.project-info').click();
    await expect(page.locator('#home')).toBeHidden();
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
    await expect(page.locator('#home')).toBeVisible(); // двойной клик по названию — не открытие
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
    await page.locator('#home .project-card').nth(1).locator('.project-info').click();
    await expect(page.locator('#home')).toBeHidden();
    expect((await board.state()).project.name).toBe('Геометрия');
  });

  test('удаление проектов', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    await expect(page.locator('#home .project-card')).toHaveCount(2);

    let msg = onConfirm(page, false);
    await page.locator('#home .project-card').first().locator('.project-del').click();
    expect(await msg).toBe('Удалить проект «Проект 2» со всеми страницами?');
    await expect(page.locator('#home .project-card')).toHaveCount(2);

    // удаление открытого проекта открывает следующий
    msg = onConfirm(page, true);
    await page.locator('#home .project-card').first().locator('.project-del').click();
    await msg;
    await expect(page.locator('#home .project-name')).toHaveText(['Проект 1']);
    await expect(page.locator('#home')).toBeVisible(); // остаёмся в списке проектов
    expect((await board.state()).project.name).toBe('Проект 1');

    // удаление последнего создаёт пустой
    msg = onConfirm(page, true);
    await page.locator('#home .project-del').click();
    await msg;
    await expect(page.locator('#home .project-card')).toHaveCount(1);
    const s = await board.state();
    expect(s.project.pages).toHaveLength(1);
    expect(s.projects).toHaveLength(1);
  });

  test('карусель открытого проекта: добавить, переименовать и удалить страницу', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    const card = page.locator('#home .project-card');
    const name = card.locator('.carousel-name');
    await expect(name).toHaveText('Страница 1');
    await expect(card.locator('.carousel-dots')).toBeHidden(); // одна страница — без точек
    await card.locator('.carousel-add').click();
    // карусель встаёт на новую страницу
    await expect(card.locator('.carousel-page')).toHaveText('2Страница 2');
    await expect(card.locator('.project-info')).toHaveText('2 страницы · изменён сегодня');
    await expect(card.locator('.carousel-dot')).toHaveCount(2);

    await card.locator('.carousel-page').dblclick();
    const input = card.locator('.carousel-page input');
    await input.fill('Задачи');
    await input.press('Enter');
    await expect(name).toHaveText('Задачи');
    await expect(page.locator('#home')).toBeVisible(); // двойной клик по странице — не открытие

    await card.locator('.carousel-prev').click();
    await expect(name).toHaveText('Страница 1');
    const msg = onConfirm(page, true);
    await card.locator('.carousel-del').click();
    expect(await msg).toBe('Удалить страницу «Страница 1»?');
    await expect(name).toHaveText('Задачи');
    await expect(card.locator('.project-info')).toContainText('1 страница');

    // клик по превью открывает показанную страницу
    await card.locator('.project-preview').click();
    await expect(page.locator('#home')).toBeHidden();
    await expect(page.locator('#page-name')).toHaveValue('Задачи');
    expect((await board.state()).project.pages.map(p => p.name)).toEqual(['Задачи']);
  });

  test('добавление страницы в неоткрытый проект', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    const other = page.locator('#home .project-card').nth(1);
    // страницы неоткрытого проекта видны с превью
    await expect(other.locator('.carousel-slide canvas')).toHaveCount(1);
    await other.locator('.carousel-add').click();
    await expect(other.locator('.project-info')).toContainText('2 страницы');
    await expect(other.locator('.carousel-name')).toHaveText('Страница 2');
    await other.locator('.project-info').click();
    await expect(page.locator('#home')).toBeHidden();
    const s = await board.state();
    expect(s.project.pages.map(p => p.name)).toEqual(['Страница 1', 'Страница 2']);
    expect(s.pageId).toBe(s.project.pages[1].id); // открылась страница, показанная в карусели
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

  test('карусель: превью страниц, стрелки и точки, начинает с текущей страницы', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    await board.addPage();
    await page.locator('#btn-home').click();
    const card = page.locator('#home .project-card');
    await expect(card.locator('.carousel-slide')).toHaveCount(2);
    // открыта вторая страница — с неё карусель и начинается
    await expect(card.locator('.carousel-page')).toHaveText('2Страница 2');
    await expect(card.locator('.carousel-dot.active')).toHaveCount(1);
    await expect(card.locator('.carousel-dot').nth(1)).toHaveClass(/active/);
    await expect(card.locator('.carousel-next')).toBeHidden();
    // превью первой страницы с прямоугольником отличается от пустой второй
    const canvases = card.locator('.carousel-slide canvas');
    await expect(canvases).toHaveCount(2);
    const shots = await canvases.evaluateAll(cs => cs.map(c => (c as HTMLCanvasElement).toDataURL()));
    expect(shots[0]).not.toBe(shots[1]);

    await card.locator('.carousel-prev').click();
    await expect(card.locator('.carousel-name')).toHaveText('Страница 1');
    await expect(card.locator('.carousel-prev')).toBeHidden();
    await expect(card.locator('.carousel-dot').first()).toHaveClass(/active/);
    await expect(page.locator('#home')).toBeVisible(); // стрелка — не открытие
    await card.locator('.carousel-dot').nth(1).click();
    await expect(card.locator('.carousel-name')).toHaveText('Страница 2');
    await card.locator('.carousel-dot').first().click();
    await expect(card.locator('.carousel-name')).toHaveText('Страница 1');
    await expect(page.locator('#home')).toBeVisible();

    await card.locator('.project-preview').click();
    await expect(page.locator('#home')).toBeHidden();
    await expect(page.locator('#page-name')).toHaveValue('Страница 1');
  });

  test('карусель начинает с последней открытой страницы, и после перезапуска', async ({ board, page }) => {
    await board.addPage();
    await board.addPage();
    await page.locator('#pages-list .page-item').nth(1).click();
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    const other = page.locator('#home .project-card', { hasText: 'Проект 1' });
    await expect(other.locator('.carousel-name')).toHaveText('Страница 2');

    // пролистали, но не открыли — после перезапуска снова с открытой
    await other.locator('.carousel-next').click();
    await expect(other.locator('.carousel-name')).toHaveText('Страница 3');
    await page.reload();
    await board.ready();
    await page.locator('#btn-home').click();
    await expect(other.locator('.carousel-name')).toHaveText('Страница 2');

    // открыли третью — теперь карусель с неё
    await other.locator('.carousel-next').click();
    await other.locator('.project-preview').click();
    await expect(page.locator('#page-name')).toHaveValue('Страница 3');
    await page.locator('#btn-home').click();
    await expect(other.locator('.carousel-name')).toHaveText('Страница 3');
  });

  test('вид списком: колонки, открытие, переименование; вид запоминается', async ({ board, page }) => {
    await board.addPage();
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    const home = page.locator('#home');
    const grid = home.locator('.home-view[data-view="grid"]');
    const list = home.locator('.home-view[data-view="list"]');
    await expect(grid).toHaveAttribute('aria-pressed', 'true');
    await list.click();
    await expect(list).toHaveAttribute('aria-pressed', 'true');
    await expect(grid).toHaveAttribute('aria-pressed', 'false');
    await expect(home.locator('.home-grid')).toHaveCount(0);
    await expect(home.locator('.home-list-head span')).toHaveText(['', 'Название', 'Страниц', 'Открыт', '']);
    const rows = home.locator('.project-row');
    await expect(rows.locator('.project-name')).toHaveText(['Проект 2', 'Проект 1']);
    await expect(rows.locator('.project-info')).toHaveText(['Изменён сегодня', 'Изменён сегодня']);
    await expect(rows.locator('.project-pages')).toHaveText(['1', '2']);
    await expect(rows.locator('.project-opened')).toHaveText(['Сегодня', 'Сегодня']);
    await expect(rows.first()).toHaveClass(/current/);

    // переименование двойным кликом по названию
    const row1 = home.locator('.project-row').nth(1);
    await row1.locator('.project-name').dblclick();
    await row1.locator('input.project-rename').fill('Геометрия');
    await row1.locator('input.project-rename').press('Enter');
    await expect(rows.locator('.project-name')).toHaveText(['Проект 2', 'Геометрия']);
    await expect(home).toBeVisible();

    // клик по строке открывает проект на последней открытой странице
    await home.locator('.project-row', { hasText: 'Геометрия' }).locator('.project-pages').click();
    await expect(home).toBeHidden();
    expect((await board.state()).project.name).toBe('Геометрия');
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');

    // вид запоминается; проект, который на этом устройстве не открывали, — без даты
    await page.locator('#btn-home').click();
    await page.evaluate(() => localStorage.removeItem('doska.opened'));
    await page.reload();
    await board.ready();
    await page.locator('#btn-home').click();
    await expect(home.locator('.home-list')).toBeVisible();
    await expect(home.locator('.project-row', { hasText: 'Проект 2' }).locator('.project-opened')).toHaveText('—');
    await expect(home.locator('.project-row', { hasText: 'Геометрия' }).locator('.project-opened')).toHaveText('Сегодня');

    // удаление из списка
    const msg = onConfirm(page, true);
    await home.locator('.project-row', { hasText: 'Проект 2' }).locator('.project-del').click();
    await msg;
    await expect(rows.locator('.project-name')).toHaveText(['Геометрия']);

    await grid.click();
    await expect(home.locator('.home-grid .project-card')).toHaveCount(1);
    await expect(home.locator('.home-list')).toHaveCount(0);
  });

  test('иконка проекта: эмодзи из разделов и поиска, своя картинка, убрать', async ({ page }) => {
    await page.locator('#btn-home').click();
    const card = page.locator('#home .project-card');
    const badge = card.locator('.project-icon.badge');
    await expect(badge).toHaveClass(/empty/);
    await badge.click();
    const picker = page.locator('#icon-picker');
    await expect(picker).toBeVisible();
    await expect(picker.locator('.ip-search')).toBeFocused();
    await expect(picker.locator('.ip-remove')).toHaveCount(0); // убирать пока нечего
    await expect(picker.locator('.ip-tab')).toHaveCount(8);
    await expect(picker.locator('.ip-section[data-cat] .ip-emoji').first()).toHaveText('😀');
    await expect(picker.locator('.ip-tab').first()).toHaveAttribute('aria-selected', 'true');

    // вкладка прокручивает к своему разделу
    await picker.locator('.ip-tab').nth(1).click();
    await expect(picker.locator('.ip-tab').nth(1)).toHaveAttribute('aria-selected', 'true');
    const offset = await picker.locator('.ip-section[data-cat="a"]').evaluate(s => (s as HTMLElement).offsetTop - s.parentElement!.scrollTop);
    expect(Math.abs(offset)).toBeLessThan(2);

    // поиск по-русски: точное название — первым
    const search = picker.locator('.ip-search');
    await search.fill('абракадабра');
    await expect(picker.locator('.ip-results .ip-title')).toHaveText('Ничего не нашлось');
    await search.fill('ракета');
    await expect(picker.locator('.ip-results .ip-title')).toHaveText('Найдено');
    await expect(picker.locator('.ip-results .ip-emoji').first()).toHaveText('🚀');
    await search.press('Enter');
    await expect(picker).toHaveCount(0);
    await expect(badge).toHaveText('🚀');
    await expect(badge).not.toHaveClass(/empty/);
    await expect(page.locator('#project-icon')).toHaveText('🚀'); // и в шапке доски
    expect(await page.evaluate(() => (window as any).__doska.state.project.icon)).toBe('🚀');

    // своя картинка обрезается в квадрат 64×64
    await badge.click();
    await expect(picker.locator('.ip-emoji.active')).toHaveText('🚀');
    const png = await page.evaluate(() => {
      const cv = document.createElement('canvas');
      cv.width = 120;
      cv.height = 60;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#e33';
      ctx.fillRect(0, 0, 120, 60);
      return cv.toDataURL('image/png').split(',')[1];
    });
    await picker.locator('input[type="file"]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(picker).toHaveCount(0);
    await expect(badge.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    const size = await page.evaluate(async () => {
      const img = new Image();
      img.src = (window as any).__doska.state.project.icon;
      await img.decode();
      return [img.naturalWidth, img.naturalHeight];
    });
    expect(size).toEqual([64, 64]);

    // убрать
    await badge.click();
    await picker.locator('.ip-remove').click();
    await expect(picker).toHaveCount(0);
    await expect(badge).toHaveClass(/empty/);
    expect(await page.evaluate(() => (window as any).__doska.state.project.icon)).toBeUndefined();

    // Esc и клик мимо закрывают окно
    await badge.click();
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await badge.click();
    await expect(picker).toBeVisible();
    await page.mouse.click(1200, 800);
    await expect(picker).toHaveCount(0);
    await expect(page.locator('#home')).toBeVisible();
  });

  test('иконка неоткрытого проекта сохраняется; в шапке доски — у открытого', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    await page.locator('#home .new-project').click();
    await page.locator('#btn-home').click();
    const other = page.locator('#home .project-card', { hasText: 'Проект 1' });
    await other.locator('.project-icon.badge').click();
    const picker = page.locator('#icon-picker');
    await picker.locator('.ip-section[data-cat] .ip-emoji').first().click();
    await expect(other.locator('.project-icon.badge')).toHaveText('😀');

    await page.reload();
    await board.ready();
    // открыт «Проект 2» — у него иконки нет, в шапке приглашение её поставить
    await expect(page.locator('#project-icon')).toHaveClass(/empty/);
    await page.locator('#btn-home').click();
    await expect(other.locator('.project-icon.badge')).toHaveText('😀');
    await page.locator('#home .home-view[data-view="list"]').click();
    await expect(page.locator('#home .project-row', { hasText: 'Проект 1' }).locator('.project-icon.row')).toHaveText('😀');
    await expect(page.locator('#home .project-row', { hasText: 'Проект 2' }).locator('.project-icon.row')).toHaveClass(/empty/);
    // открыли — иконка в шапке; там же её и меняют
    await page.locator('#home .project-row', { hasText: 'Проект 1' }).locator('.project-pages').click();
    await expect(page.locator('#project-icon')).toHaveText('😀');
    await page.locator('#project-icon').click();
    await picker.locator('.ip-search').fill('кот');
    await picker.locator('.ip-search').press('Enter');
    await expect(picker).toHaveCount(0);
    const icon = await page.evaluate(() => (window as any).__doska.state.project.icon);
    expect(icon).not.toBe('😀');
    await expect(page.locator('#project-icon')).toHaveText(icon);
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
    await expect(home.locator('.home-section')).toHaveCount(1); // пустой раздел «Остальные» не показываем
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
