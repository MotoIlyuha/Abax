import { byTip, expect, test } from './fixtures';

test.describe('выделение и перемещение', () => {
  test('клик выделяет, быстрое меню появляется, повторный клик снимает', async ({ board }) => {
    const r = await board.rect(400, 300, 550, 400);
    await board.tool('v');
    await board.click({ x: 470, y: 350 });
    expect((await board.state()).selection).toEqual([r.id]);
    await expect(board.quickMenu).toBeVisible();
    await board.click({ x: 470, y: 350 });
    expect((await board.state()).selection).toEqual([]);
    await expect(board.quickMenu).toBeHidden();
  });

  test('перетаскивание сдвигает элемент, отмена возвращает', async ({ board, page }) => {
    await board.rect(400, 300, 550, 400);
    await board.tool('v');
    await board.drag([{ x: 470, y: 350 }, { x: 570, y: 400 }]);
    expect((await board.elements())[0]).toMatchObject({ x: 500, y: 350 });
    await page.keyboard.press('Control+z');
    expect((await board.elements())[0]).toMatchObject({ x: 400, y: 300 });
  });

  test('штрихи и ломаные сдвигаются по точкам', async ({ board }) => {
    await board.drag([{ x: 400, y: 300 }, { x: 500, y: 300 }]);
    const before = (await board.elements())[0].pts[0];
    await board.tool('v');
    await board.drag([{ x: 450, y: 300 }, { x: 450, y: 380 }]);
    const after = (await board.elements())[0].pts[0];
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y + 80);
  });

  test('рамка выделяет задетые элементы, Shift добавляет и убирает', async ({ board }) => {
    const a = await board.rect(400, 300, 450, 350);
    const b = await board.rect(500, 300, 550, 350);
    const c = await board.rect(700, 500, 750, 550);
    await board.tool('v');
    await board.drag([{ x: 380, y: 280 }, { x: 520, y: 320 }]);
    expect((await board.state()).selection.sort()).toEqual([a.id, b.id].sort());
    await board.click({ x: 720, y: 520 }, { modifiers: ['Shift'] });
    expect((await board.state()).selection).toHaveLength(3);
    await board.click({ x: 420, y: 320 }, { modifiers: ['Shift'] });
    expect((await board.state()).selection.sort()).toEqual([b.id, c.id].sort());
    await board.click({ x: 900, y: 700 }); // мимо — снять всё
    expect((await board.state()).selection).toEqual([]);
  });

  test('Delete и кнопка корзины удаляют выделенное', async ({ board, page }) => {
    await board.rect(400, 300, 450, 350);
    await board.rect(500, 300, 550, 350);
    await board.tool('v');
    await board.click({ x: 420, y: 320 });
    await page.keyboard.press('Delete');
    expect(await board.count()).toBe(1);
    await board.click({ x: 520, y: 320 });
    await byTip(board.quickMenu, 'Удалить (Del)').click();
    expect(await board.count()).toBe(0);
    await page.keyboard.press('Control+z');
    expect(await board.count()).toBe(1);
  });

  test('группировка: клик выделяет всю группу, разгруппировка', async ({ board, page }) => {
    const a = await board.rect(400, 300, 450, 350);
    const b = await board.rect(500, 300, 550, 350);
    await board.tool('v');
    await board.drag([{ x: 380, y: 280 }, { x: 560, y: 360 }]);
    await page.keyboard.press('Control+g');
    const els = await board.elements();
    expect(els[0].groupId).toBeTruthy();
    expect(els[1].groupId).toBe(els[0].groupId);
    await expect(byTip(board.quickMenu, 'Разгруппировать (Ctrl+Shift+G)')).toBeVisible();

    await board.click({ x: 900, y: 700 });
    await board.click({ x: 420, y: 320 });
    expect((await board.state()).selection.sort()).toEqual([a.id, b.id].sort());

    // перемещение группы целиком
    await board.drag([{ x: 420, y: 320 }, { x: 440, y: 340 }]);
    expect((await board.elements()).map(e => e.x)).toEqual([420, 520]);

    await byTip(board.quickMenu, 'Разгруппировать (Ctrl+Shift+G)').click();
    expect((await board.elements()).every(e => !e.groupId)).toBe(true);
    await expect(byTip(board.quickMenu, 'Сгруппировать (Ctrl+G)')).toBeVisible();
    await byTip(board.quickMenu, 'Сгруппировать (Ctrl+G)').click();
    expect((await board.elements())[0].groupId).toBeTruthy();
    await page.keyboard.press('Control+Shift+g');
    expect((await board.elements()).every(e => !e.groupId)).toBe(true);
  });

  test('слои: кнопки «выше/ниже» только при перекрытии', async ({ board }) => {
    const a = await board.rect(400, 300, 500, 400);
    const b = await board.rect(450, 350, 550, 450);
    await board.rect(800, 300, 850, 350);
    await board.tool('v');
    await board.click({ x: 420, y: 320 });
    await expect(byTip(board.quickMenu, 'Выше (слой)')).toBeVisible();
    await expect(byTip(board.quickMenu, 'Ниже (слой)')).toHaveCount(0);
    await byTip(board.quickMenu, 'Выше (слой)').click();
    expect((await board.elements()).slice(0, 2).map(e => e.id)).toEqual([b.id, a.id]);
    await expect(byTip(board.quickMenu, 'Ниже (слой)')).toBeVisible();
    await byTip(board.quickMenu, 'Ниже (слой)').click();
    expect((await board.elements()).slice(0, 2).map(e => e.id)).toEqual([a.id, b.id]);

    await board.click({ x: 820, y: 320 }); // одиночный элемент — без слоёв
    await expect(byTip(board.quickMenu, 'Выше (слой)')).toHaveCount(0);
    await expect(byTip(board.quickMenu, 'Ниже (слой)')).toHaveCount(0);
  });

  test('текст: полужирный и курсив из быстрого меню', async ({ board, page }) => {
    await board.tool('t');
    await board.click({ x: 400, y: 300 });
    await page.keyboard.type('Теорема');
    await page.keyboard.press('Enter');
    await board.tool('v');
    await board.click({ x: 420, y: 312 });
    await board.quickMenu.locator('.qm-text-b').click();
    await expect(board.quickMenu.locator('.qm-text-b')).toHaveClass(/active/);
    await board.quickMenu.locator('.qm-text-i').click();
    expect((await board.elements())[0]).toMatchObject({ bold: true, italic: true });
    await board.quickMenu.locator('.qm-text-b').click();
    expect((await board.elements())[0].bold).toBe(false);
  });
});

test.describe('ручки редактирования', () => {
  test('угловая ручка меняет размер, Shift — с пропорциями', async ({ board }) => {
    await board.rect(400, 300, 600, 400);
    await board.tool('v');
    await board.click({ x: 500, y: 350 });
    await board.drag([{ x: 600, y: 400 }, { x: 700, y: 450 }]);
    expect((await board.elements())[0]).toMatchObject({ x: 400, y: 300, w: 300, h: 150 });
    await board.drag([{ x: 700, y: 450 }, { x: 800, y: 460 }], { modifiers: ['Shift'] });
    const r = (await board.elements())[0];
    expect(r.w / r.h).toBeCloseTo(2, 1);
  });

  test('ручка поворота с примагничиванием к 90°', async ({ board }) => {
    await board.rect(400, 300, 600, 400);
    await board.tool('v');
    await board.click({ x: 500, y: 350 });
    // ручка поворота в 30px над верхней гранью; ведём её вправо от центра
    await board.drag([{ x: 500, y: 270 }, { x: 600, y: 300 }, { x: 650, y: 352 }], { steps: 10 });
    expect((await board.elements())[0].rot).toBeCloseTo(Math.PI / 2, 2);
  });

  test('концы линии', async ({ board }) => {
    await board.tool('l');
    await board.drag([{ x: 400, y: 300 }, { x: 600, y: 300 }]);
    await board.tool('v');
    await board.click({ x: 500, y: 300 });
    await board.drag([{ x: 600, y: 300 }, { x: 600, y: 450 }]);
    expect((await board.elements())[0]).toMatchObject({ x: 400, y: 300, w: 200, h: 150 });
  });

  test('ломаная: перенос, вставка и удаление узлов', async ({ board, page }) => {
    await board.tool('k');
    for (const p of [{ x: 400, y: 300 }, { x: 600, y: 300 }, { x: 600, y: 500 }]) await board.click(p);
    await page.keyboard.press('Enter');
    await board.tool('v');
    await board.click({ x: 500, y: 300 });
    // узел
    await board.drag([{ x: 600, y: 500 }, { x: 650, y: 520 }]);
    expect((await board.elements())[0].pts[2]).toMatchObject({ x: 650, y: 520 });
    // середина ребра — вставка узла
    await board.drag([{ x: 500, y: 300 }, { x: 500, y: 250 }]);
    let pts = (await board.elements())[0].pts;
    expect(pts).toHaveLength(4);
    expect(pts[1]).toMatchObject({ x: 500, y: 250 });
    // двойной клик по узлу — удалить
    await board.dblclick({ x: 500, y: 250 });
    pts = (await board.elements())[0].pts;
    expect(pts).toHaveLength(3);
  });

  test('привязка к сетке при перемещении', async ({ board, page }) => {
    await page.locator('#btn-settings').click();
    await page.locator('#settings-popover label', { hasText: 'Привязка к сетке' }).locator('input').check();
    await page.keyboard.press('Escape');
    await board.rect(400, 300, 500, 380);
    await board.tool('v');
    await board.drag([{ x: 450, y: 340 }, { x: 467, y: 353 }]);
    const r = (await board.elements())[0];
    expect(r.x % 40).toBe(0);
    expect(r.y % 40).toBe(0);
  });
});

test.describe('камера', () => {
  test('масштаб клавишами и метка масштаба', async ({ page }) => {
    await page.keyboard.press('Equal');
    await expect(page.locator('#zoom-label')).toHaveText('125%');
    await page.keyboard.press('Minus');
    await page.keyboard.press('Minus');
    await expect(page.locator('#zoom-label')).toHaveText('80%');
  });

  test('колёсико прокручивает, Ctrl+колёсико — масштаб под курсором', async ({ board, page }) => {
    const s = await board.screen({ x: 500, y: 400 });
    await page.mouse.move(s.x, s.y);
    await page.mouse.wheel(0, 120);
    expect((await board.state()).camera).toMatchObject({ x: 0, y: 120, zoom: 1 });
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 120);
    await page.keyboard.up('Shift');
    expect((await board.state()).camera).toMatchObject({ x: 120, y: 120 });

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    const cam = (await board.state()).camera;
    expect(cam.zoom).toBeGreaterThan(1);
    // точка под курсором осталась на месте
    const box = (await board.canvas.boundingBox())!;
    const sceneX = (s.x - box.x) / cam.zoom + cam.x;
    expect(sceneX).toBeCloseTo(500 + 120, 3);
  });

  test('режим колёсика «Масштаб» из настроек', async ({ board, page }) => {
    await page.locator('#btn-settings').click();
    await page.locator('#settings-popover button', { hasText: 'Масштаб' }).click();
    await expect(page.locator('#settings-popover button', { hasText: 'Масштаб' })).toHaveClass(/active/);
    const s = await board.screen({ x: 500, y: 400 });
    await page.mouse.move(s.x, s.y);
    await page.mouse.wheel(0, -120);
    expect((await board.state()).camera.zoom).toBeGreaterThan(1);
  });

  test('панорама инструментом, пробелом и средней кнопкой', async ({ board, page }) => {
    await board.tool('h');
    await board.drag([{ x: 500, y: 400 }, { x: 400, y: 350 }]);
    expect((await board.state()).camera).toMatchObject({ x: 100, y: 50 });

    await board.tool('p');
    await page.keyboard.down('Space');
    const a = await board.screen({ x: 500, y: 400 });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 100, a.y + 50, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    expect((await board.state()).camera).toMatchObject({ x: 0, y: 0 });
    expect(await board.count()).toBe(0); // пробел не рисует

    await page.mouse.move(a.x, a.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(a.x - 30, a.y, { steps: 3 });
    await page.mouse.up({ button: 'middle' });
    expect((await board.state()).camera.x).toBe(30);
  });

  test('«Показать всё» вписывает содержимое', async ({ board, page }) => {
    await board.rect(400, 300, 500, 400);
    // дальний элемент рисуем, отъехав камерой
    for (let i = 0; i < 6; i++) await page.keyboard.press('Minus');
    await board.rect(2500, 1700, 2600, 1800);
    for (let i = 0; i < 9; i++) await page.keyboard.press('Equal');
    expect((await board.state()).camera.zoom).toBeGreaterThan(1.5);
    await page.locator('#btn-fit').click();
    const cam = (await board.state()).camera;
    expect(cam.zoom).toBeLessThan(1);
    // оба элемента на экране
    const box = (await board.canvas.boundingBox())!;
    for (const p of [{ x: 400, y: 300 }, { x: 2600, y: 1800 }]) {
      const s = await board.screen(p);
      expect(s.x).toBeGreaterThan(box.x);
      expect(s.x).toBeLessThan(box.x + box.width);
      expect(s.y).toBeGreaterThan(box.y);
      expect(s.y).toBeLessThan(box.y + box.height);
    }
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Digit0'); // пустая страница — центр в нуле
    expect((await board.state()).camera.zoom).toBe(1);
  });
});
