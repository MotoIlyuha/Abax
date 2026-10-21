import { expect, test } from './fixtures';

test.describe('загрузка', () => {
  test('новый пользователь получает проект с одной страницей', async ({ board, page }) => {
    await expect(page).toHaveTitle('Доска');
    const s = await board.state();
    expect(s.project.name).toBe('Проект 1');
    expect(s.project.pages.map(p => p.name)).toEqual(['Страница 1']);
    expect(s.tool).toBe('pen');
    await expect(page.locator('#page-name')).toHaveValue('Страница 1');
    await expect(page.locator('#project-name')).toHaveText('Проект 1');
    await expect(page.locator('.tool[data-tool="pen"]')).toHaveClass(/active/);
    await expect(page.locator('#btn-undo')).toBeDisabled();
    await expect(page.locator('#btn-redo')).toBeDisabled();
    await expect(page.locator('#zoom-label')).toHaveText('100%');
  });

  test('последний открытый проект восстанавливается после перезагрузки', async ({ board, page }) => {
    await board.drag([{ x: 400, y: 300 }, { x: 500, y: 350 }]);
    await board.saved();
    const id = (await board.state()).project.id;
    await page.reload();
    await board.ready();
    expect((await board.state()).project.id).toBe(id);
    expect(await board.count('stroke')).toBe(1);
  });
});

test.describe('перо и маркер', () => {
  test('перо рисует штрих текущим цветом и толщиной', async ({ board }) => {
    await board.drag([{ x: 400, y: 300 }, { x: 500, y: 320 }, { x: 600, y: 400 }]);
    const [s] = await board.elements();
    expect(s).toMatchObject({ type: 'stroke', tool: 'pen', color: '#1f2329', width: 4 });
    expect(s.pts.length).toBeGreaterThan(3);
    expect(s.pts[0].x).toBeCloseTo(400, 0);
    expect(s.pts[0].y).toBeCloseTo(300, 0);
  });

  test('клик пером ставит точку', async ({ board }) => {
    await board.click({ x: 450, y: 450 });
    const [s] = await board.elements();
    expect(s.pts).toHaveLength(1);
  });

  test('маркер — широкий полупрозрачный штрих', async ({ board, page }) => {
    await board.tool('m');
    await expect(page.locator('.tool[data-tool="highlighter"]')).toHaveClass(/active/);
    await board.drag([{ x: 400, y: 300 }, { x: 600, y: 300 }]);
    const [s] = await board.elements();
    expect(s).toMatchObject({ tool: 'highlighter', width: 4 * 3.2 });
  });

  test('выбор инструмента кликом по тулбару', async ({ board, page }) => {
    for (const id of ['select', 'pan', 'highlighter', 'eraser', 'text', 'pen']) {
      await page.locator(`.tool[data-tool="${id}"]`).click();
      expect((await board.state()).tool).toBe(id);
      await expect(page.locator(`.tool[data-tool="${id}"]`)).toHaveClass(/active/);
    }
  });

  test('горячие клавиши инструментов', async ({ board }) => {
    const map: Record<string, string> = {
      v: 'select', p: 'pen', m: 'highlighter', e: 'eraser', h: 'pan', t: 'text', r: 'rect', o: 'ellipse',
      y: 'triangle', l: 'line', a: 'arrow', i: 'laser', k: 'poly', n: 'note',
    };
    for (const [key, tool] of Object.entries(map)) {
      await board.tool(key);
      expect((await board.state()).tool, `клавиша ${key}`).toBe(tool);
    }
  });
});

test.describe('отмена и повтор', () => {
  test('кнопки и сочетания клавиш', async ({ board, page }) => {
    await board.drag([{ x: 400, y: 300 }, { x: 500, y: 300 }]);
    await board.drag([{ x: 400, y: 400 }, { x: 500, y: 400 }]);
    expect(await board.count()).toBe(2);
    await expect(page.locator('#btn-undo')).toBeEnabled();

    await page.locator('#btn-undo').click();
    expect(await board.count()).toBe(1);
    await expect(page.locator('#btn-redo')).toBeEnabled();
    await page.locator('#btn-redo').click();
    expect(await board.count()).toBe(2);

    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await board.count()).toBe(0);
    await expect(page.locator('#btn-undo')).toBeDisabled();
    await page.keyboard.press('Control+y');
    expect(await board.count()).toBe(1);
    await page.keyboard.press('Control+Shift+z');
    expect(await board.count()).toBe(2);
    await expect(page.locator('#btn-redo')).toBeDisabled();
  });
});

test.describe('фигуры', () => {
  test('прямоугольник через панель «Фигуры»', async ({ board, page }) => {
    await board.groupTool('shapes', 'rect');
    await expect(page.locator('#btn-shapes')).toHaveClass(/active/);
    await expect(page.locator('#ctx-layer .ctx-panel')).toHaveCount(0); // панель закрылась после выбора
    await board.drag([{ x: 600, y: 500 }, { x: 400, y: 300 }]); // протягивание в обратную сторону
    const [r] = await board.elements();
    expect(r).toMatchObject({ type: 'shape', shape: 'rect', x: 400, y: 300, w: 200, h: 200, width: 4 * 1.3 });
  });

  for (const [key, shape] of [['o', 'ellipse'], ['y', 'triangle']] as const) {
    test(`${shape}: клавиша ${key.toUpperCase()}`, async ({ board, page }) => {
      await board.tool(key);
      await board.drag([{ x: 400, y: 300 }, { x: 550, y: 380 }]);
      const [el] = await board.elements();
      expect(el).toMatchObject({ shape, x: 400, y: 300, w: 150, h: 80 });
      // кнопка группы показывает иконку последнего инструмента
      await expect(page.locator('#btn-shapes')).toHaveAttribute('data-shape', shape);
    });
  }

  test('линия и стрелка сохраняют направление', async ({ board }) => {
    await board.tool('l');
    await board.drag([{ x: 600, y: 400 }, { x: 400, y: 300 }]);
    await board.tool('a');
    await board.drag([{ x: 400, y: 500 }, { x: 600, y: 450 }]);
    const [l, a] = await board.elements();
    expect(l).toMatchObject({ shape: 'line', x: 600, y: 400, w: -200, h: -100 });
    expect(a).toMatchObject({ shape: 'arrow', x: 400, y: 500, w: 200, h: -50 });
  });

  test('Shift: квадрат и линия под 45°', async ({ board }) => {
    await board.tool('r');
    await board.drag([{ x: 400, y: 300 }, { x: 500, y: 340 }], { modifiers: ['Shift'] });
    await board.tool('l');
    await board.drag([{ x: 400, y: 500 }, { x: 500, y: 590 }], { modifiers: ['Shift'] });
    const [sq, ln] = await board.elements();
    expect(sq.w).toBe(sq.h);
    expect(Math.abs(ln.w)).toBeCloseTo(Math.abs(ln.h), 5);
  });

  test('Alt: от центра', async ({ board }) => {
    await board.tool('r');
    await board.drag([{ x: 500, y: 400 }, { x: 560, y: 440 }], { modifiers: ['Alt'] });
    const [r] = await board.elements();
    expect(r).toMatchObject({ x: 440, y: 360, w: 120, h: 80 });
  });

  test('случайный клик фигурой ничего не создаёт', async ({ board }) => {
    await board.tool('r');
    await board.click({ x: 500, y: 400 });
    expect(await board.count()).toBe(0);
  });
});

test.describe('ломаная', () => {
  const pts = [{ x: 400, y: 300 }, { x: 600, y: 300 }, { x: 600, y: 450 }];

  test('Enter завершает открытую ломаную', async ({ board, page }) => {
    await board.tool('k');
    for (const p of pts) await board.click(p);
    await board.move({ x: 500, y: 500 });
    expect((await board.state()).livePoly).toBe(3);
    await page.keyboard.press('Enter');
    const [el] = await board.elements();
    expect(el).toMatchObject({ type: 'poly', closed: false });
    expect(el.pts).toHaveLength(3);
  });

  test('клик по первой точке замыкает контур', async ({ board }) => {
    await board.tool('k');
    for (const p of pts) await board.click(p);
    await board.click({ x: 403, y: 302 });
    const [el] = await board.elements();
    expect(el).toMatchObject({ closed: true });
    expect(el.pts).toHaveLength(3);
  });

  test('двойной клик и правая кнопка завершают, Esc отменяет', async ({ board, page }) => {
    await board.tool('k');
    await board.click(pts[0]);
    await board.dblclick(pts[1]);
    expect(await board.count('poly')).toBe(1);

    await board.click(pts[0]);
    await board.click(pts[1]);
    await board.click(pts[2], { button: 'right' });
    expect(await board.count('poly')).toBe(2);

    await board.click(pts[0]);
    await board.click(pts[1]);
    await page.keyboard.press('Escape');
    expect((await board.state()).livePoly).toBeNull();
    expect(await board.count('poly')).toBe(2);
  });
});

test.describe('ластик', () => {
  test('стирает задетые элементы одним действием истории', async ({ board, page }) => {
    await board.drag([{ x: 400, y: 300 }, { x: 600, y: 300 }]);
    await board.drag([{ x: 400, y: 400 }, { x: 600, y: 400 }]);
    await board.drag([{ x: 400, y: 600 }, { x: 600, y: 600 }]);
    await board.tool('e');
    // одно резкое движение: между событиями мыши линии тоже стираются
    await board.drag([{ x: 500, y: 250 }, { x: 500, y: 450 }], { steps: 1 });
    expect(await board.count()).toBe(1);
    await page.keyboard.press('Control+z');
    expect(await board.count()).toBe(3);
  });

  test('мимо элементов ничего не меняет', async ({ board, page }) => {
    await board.drag([{ x: 400, y: 300 }, { x: 600, y: 300 }]);
    await board.tool('e');
    await board.drag([{ x: 400, y: 600 }, { x: 600, y: 600 }]);
    expect(await board.count()).toBe(1);
    await page.keyboard.press('Control+z'); // отменяется сам штрих, а не «пустое» стирание
    expect(await board.count()).toBe(0);
  });
});

test.describe('текст и стикеры', () => {
  test('текст: ввод, Enter — сохранить; Shift+Enter — новая строка', async ({ board, page }) => {
    await board.tool('t');
    await board.click({ x: 400, y: 300 });
    const ta = page.locator('#overlay textarea.inplace-edit');
    await expect(ta).toBeFocused();
    await ta.pressSequentially('Пусть x = 2');
    await ta.press('Shift+Enter');
    await ta.pressSequentially('тогда y = 4   ');
    await ta.press('Enter');
    await expect(ta).toHaveCount(0);
    const [t] = await board.elements();
    expect(t).toMatchObject({ type: 'text', x: 400, y: 300, text: 'Пусть x = 2\nтогда y = 4', size: 24, color: '#1f2329' });
  });

  test('Esc и пустой текст ничего не создают', async ({ board, page }) => {
    await board.tool('t');
    await board.click({ x: 400, y: 300 });
    await page.keyboard.type('черновик');
    await page.keyboard.press('Escape');
    await board.click({ x: 400, y: 500 });
    await page.keyboard.press('Enter');
    expect(await board.count()).toBe(0);
  });

  test('двойной клик редактирует текст, очистка — удаляет', async ({ board, page }) => {
    await board.tool('t');
    await board.click({ x: 400, y: 300 });
    await page.keyboard.type('abc');
    await page.keyboard.press('Enter');
    await board.tool('v');
    await board.dblclick({ x: 410, y: 312 });
    const ta = page.locator('textarea.inplace-edit');
    await expect(ta).toHaveValue('abc');
    await ta.fill('abcdef');
    await ta.press('Enter');
    expect((await board.elements())[0].text).toBe('abcdef');

    await board.dblclick({ x: 410, y: 312 });
    await page.locator('textarea.inplace-edit').fill('');
    await page.keyboard.press('Enter');
    expect(await board.count()).toBe(0);
    await page.keyboard.press('Control+z');
    expect((await board.elements())[0].text).toBe('abcdef');
  });

  test('текст фиксируется при потере фокуса', async ({ board, page }) => {
    await board.tool('t');
    await board.click({ x: 400, y: 300 });
    await page.keyboard.type('blur');
    await page.locator('#page-name').click();
    expect((await board.elements())[0]?.text).toBe('blur');
  });

  test('стикер: панель цвета, ввод текста, переход на выделение', async ({ board, page }) => {
    await board.tool('n');
    const panel = page.locator('.ctx-panel[data-kind="note"]');
    await expect(panel).toBeVisible();
    await panel.locator('.ctx-swatch[data-c="#a9def9"]').click();
    await expect(panel.locator('.ctx-swatch[data-c="#a9def9"]')).toHaveClass(/active/);
    await board.click({ x: 500, y: 400 });
    expect((await board.state()).tool).toBe('select');
    await page.keyboard.type('Домашка: №5');
    await page.keyboard.press('Enter');
    const [n] = await board.elements();
    expect(n).toMatchObject({ type: 'note', text: 'Домашка: №5', color: '#a9def9', w: 216, h: 168, x: 500 - 108, y: 400 - 84 });
  });

  test('двойной клик по стикеру — редактирование', async ({ board, page }) => {
    await board.tool('n');
    await board.click({ x: 500, y: 400 });
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await board.dblclick({ x: 500, y: 400 });
    const ta = page.locator('textarea.inplace-edit.note');
    await expect(ta).toHaveValue('1');
    await ta.fill('2');
    await ta.press('Enter');
    expect((await board.elements())[0].text).toBe('2');
  });
});

test.describe('стереометрия', () => {
  test('клик телом создаёт его стандартного размера и выделяет', async ({ board, page }) => {
    await board.groupTool('solids', 'cube');
    await board.click({ x: 600, y: 450 });
    const [c] = await board.elements();
    expect(c).toMatchObject({ type: 'solid', solid: 'cube' });
    expect(c.w).toBe(c.h);
    const s = await board.state();
    expect(s.tool).toBe('select');
    expect(s.selection).toEqual([c.id]);
    await expect(page.locator('#btn-solids')).toHaveAttribute('data-shape', 'cube');
  });

  for (const kind of ['box', 'prism', 'pyramid', 'truncPyramid', 'cylinder', 'cone', 'truncCone', 'sphere']) {
    test(`протягивание: ${kind}`, async ({ board }) => {
      await board.groupTool('solids', kind);
      await board.drag([{ x: 400, y: 250 }, { x: 650, y: 550 }]);
      const [el] = await board.elements();
      expect(el).toMatchObject({ type: 'solid', solid: kind });
      expect(el.w).toBeGreaterThan(100);
    });
  }

  test('число сторон основания призмы в быстром меню', async ({ board, page }) => {
    await board.groupTool('solids', 'prism');
    await board.click({ x: 600, y: 450 });
    const sides = page.locator('#quick-menu .qm-sides');
    await expect(sides.locator('.qm-sides-val')).toHaveText('n = 3');
    await expect(sides.locator('button').first()).toBeDisabled();
    await sides.locator('button').last().click();
    await expect(sides.locator('.qm-sides-val')).toHaveText('n = 4');
    for (let i = 0; i < 4; i++) await sides.locator('button').last().click();
    await expect(sides.locator('.qm-sides-val')).toHaveText('n = 8');
    await expect(sides.locator('button').last()).toBeDisabled();
    expect((await board.elements())[0].n).toBe(8);
    await sides.locator('button').first().click();
    expect((await board.elements())[0].n).toBe(7);
  });

  test('ручка ребра куба меняет размер', async ({ board }) => {
    await board.groupTool('solids', 'cube');
    await board.click({ x: 600, y: 450 });
    const [c] = await board.elements();
    // ручка 'a' — в точке (x + w, y - w)
    await board.drag([{ x: c.x + c.w, y: c.y - c.w }, { x: c.x + c.w + 40, y: c.y - c.w - 40 }]);
    const [c2] = await board.elements();
    expect(c2.w).toBeCloseTo(c.w + 40, 0);
    expect(c2.h).toBe(c2.w);
  });
});

test.describe('указка', () => {
  test('лазер, исчезающий маркер и подсветка не меняют доску', async ({ board }) => {
    await board.rect(400, 300, 500, 400);
    await board.groupTool('pointer', 'laser');
    await board.move({ x: 300, y: 300 });
    await board.move({ x: 700, y: 500 }, 10);
    expect((await board.state()).laserPts).toBeGreaterThan(3);

    await board.groupTool('pointer', 'fadePen');
    await board.drag([{ x: 300, y: 600 }, { x: 700, y: 650 }]);
    expect((await board.state()).fadeStrokes).toBeGreaterThan(0);

    await board.groupTool('pointer', 'flash');
    await board.click({ x: 450, y: 350 });
    expect((await board.state()).flashes).toBe(1);
    await board.drag([{ x: 350, y: 250 }, { x: 550, y: 450 }]); // рамкой
    expect((await board.state()).flashes).toBeGreaterThanOrEqual(1);

    expect(await board.count()).toBe(1);
    expect((await board.state()).selection).toEqual([]);
    // след гаснет сам
    await expect.poll(async () => (await board.state()).fadeStrokes, { timeout: 3000 }).toBe(0);
  });
});
