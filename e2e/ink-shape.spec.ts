import { expect, test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
});

for (const mode of ['enhanced', 'normal', 'off'] as const) {
  test(`переход от штриха к фигуре на холсте: ${mode}`, async ({ board, page }) => {
    await page.evaluate(mode => { (window as any).__doska.state.settings.animationMode = mode; }, mode);
    const base = await board.screen({ x: 430, y: 330 });
    const inkY = () => board.canvas.evaluate((canvas: HTMLCanvasElement, p) => {
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.height / rect.height;
      const x = Math.round((p.x - rect.left) * canvas.width / rect.width);
      const y = Math.round((p.y - rect.top - 6) * scale);
      const pixels = canvas.getContext('2d')!.getImageData(x, y, 1, Math.round(24 * scale)).data;
      const rows: number[] = [];
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] < 128 && pixels[i + 3] > 200) rows.push(i / 4 / scale - 6);
      }
      if (!rows.length) throw Error('На срезе холста не найден штрих');
      return (rows[0] + rows[rows.length - 1]) / 2;
    }, base);
    await board.move({ x: 330, y: 330 });
    await page.mouse.down();
    for (const p of [{ x: 390, y: 338 }, { x: 465, y: 338 }, { x: 540, y: 330 }]) await board.move(p, 8);
    await page.clock.runFor(480);
    const before = await inkY();
    expect(before).toBeGreaterThan(6);
    await page.clock.runFor(140);
    await page.mouse.up();
    expect(await board.elements()).toMatchObject([{ type: 'shape', shape: 'line' }]);
    const middle = await inkY();
    await page.clock.runFor(180);
    const end = await inkY();
    expect(Math.abs(end)).toBeLessThanOrEqual(1);
    if (mode === 'enhanced') {
      expect(middle).toBeGreaterThan(end + 1);
      expect(middle).toBeLessThan(before - 1);
    } else expect(middle).toBe(end);
  });
}

test('перехлёст у вершины превращается в треугольник, который можно отменить во время перехода', async ({ board, page }) => {
  const pixels = () => board.canvas.evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data.reduce(
      (count, value, i) => count + Number(i % 4 === 0 && value < 128), 0,
    );
  });
  await page.clock.runFor(32);
  const blank = await pixels();
  await board.move({ x: 389, y: 344 });
  await page.mouse.down();
  for (const [x, y] of [[400, 367], [429, 422], [450, 479], [450, 488], [318, 488], [294, 484], [331, 426], [389, 360], [404, 338]]) {
    await board.move({ x, y }, 5);
  }
  await page.clock.runFor(560);
  expect(await board.elements()).toMatchObject([{ type: 'shape', shape: 'triangle' }]);
  expect(await pixels()).toBeGreaterThan(blank);
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  await page.clock.runFor(300);
  expect(await board.count()).toBe(0);
  expect(await pixels()).toBe(blank);
  await page.keyboard.press('Control+Shift+z');
  await page.clock.runFor(32);
  expect(await board.elements()).toMatchObject([{ type: 'shape', shape: 'triangle' }]);
  expect(await pixels()).toBeGreaterThan(blank);
});

test('перо превращает штрих в объект до отпускания ЛКМ', async ({ board, page }) => {
  const { style } = await board.state();
  await board.move({ x: 300, y: 300 });
  await page.mouse.down();
  await board.move({ x: 520, y: 390 }, 12);
  await page.clock.runFor(450);
  expect(await board.count()).toBe(0);
  // Дрожание в пределах допуска не начинает отсчёт заново.
  await board.move({ x: 521, y: 390 });
  await page.clock.runFor(50);
  expect(await board.elements()).toMatchObject([{
    type: 'shape', shape: 'line', x: 300, y: 300, w: 221, h: 90, color: style.color, width: style.width,
  }]);

  await board.move({ x: 640, y: 450 }, 5);
  await page.mouse.up();
  expect(await board.count()).toBe(1);
  expect((await board.state()).tool).toBe('pen');
  await page.keyboard.press('Control+z');
  expect(await board.count()).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  expect(await board.count('shape')).toBe(1);
});

test('движение сбрасывает задержку, а быстро отпущенное перо сохраняет штрих', async ({ board, page }) => {
  await board.move({ x: 300, y: 300 });
  await page.mouse.down();
  await board.move({ x: 400, y: 300 }, 5);
  await page.clock.runFor(400);
  await board.move({ x: 500, y: 300 }, 5);
  await page.clock.runFor(200);
  expect(await board.count()).toBe(0);
  await page.mouse.up();
  await page.clock.runFor(600);
  expect(await board.elements()).toMatchObject([{ type: 'stroke', tool: 'pen' }]);
});

test('маркер и свободный росчерк сохраняются обычными штрихами', async ({ board, page }) => {
  await board.move({ x: 300, y: 300 });
  await page.mouse.down();
  for (const p of [{ x: 370, y: 330 }, { x: 420, y: 290 }, { x: 500, y: 350 }]) await board.move(p, 5);
  await page.clock.runFor(600);
  expect(await board.count()).toBe(0);
  await page.mouse.up();

  await board.tool('m');
  await board.move({ x: 300, y: 500 });
  await page.mouse.down();
  await board.move({ x: 500, y: 500 }, 10);
  await page.clock.runFor(600);
  expect(await board.count()).toBe(1);
  await page.mouse.up();
  expect(await board.elements()).toMatchObject([{ type: 'stroke', tool: 'pen' }, { type: 'stroke', tool: 'highlighter' }]);
});

test('смена инструмента отменяет ожидающее преобразование', async ({ board, page }) => {
  await board.move({ x: 300, y: 300 });
  await page.mouse.down();
  await board.move({ x: 500, y: 300 }, 10);
  await board.tool('v');
  await page.clock.runFor(600);
  await page.mouse.up();
  expect(await board.count()).toBe(0);
});

test('стилус превращает замкнутый овал в эллипс до отрыва', async ({ board, page }) => {
  const cdp = await page.context().newCDPSession(page);
  const points = await Promise.all(Array.from({ length: 33 }, (_, i) => {
    const angle = i * Math.PI / 16;
    return board.screen({ x: 460 + 80 * Math.cos(angle), y: 380 + 45 * Math.sin(angle) });
  }));
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', ...points[0], pointerType: 'pen', button: 'left', buttons: 1, force: 0.5,
  });
  for (const p of points.slice(1)) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, pointerType: 'pen', buttons: 1, force: 0.5 });
  }
  await page.clock.runFor(500);
  const [shape] = await board.elements();
  expect(shape).toMatchObject({ type: 'shape', shape: 'ellipse' });
  expect(shape.x + shape.w / 2).toBeCloseTo(460, 0);
  expect(shape.y + shape.h / 2).toBeCloseTo(380, 0);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...points[0], pointerType: 'pen', button: 'left', buttons: 0,
  });
  expect(await board.count()).toBe(1);
});

test('удержание пальца распознаёт фигуру, а жест двумя пальцами прерывает распознавание', async ({ board, page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const vertices = await Promise.all([
    { x: 350, y: 300 }, { x: 510, y: 300 }, { x: 510, y: 420 }, { x: 350, y: 420 }, { x: 350, y: 300 },
  ].map(p => board.screen(p)));
  const trace = async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...vertices[0], id: 0 }] });
    for (const p of vertices.slice(1)) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 0 }] });
    }
  };
  await trace();
  await page.clock.runFor(500);
  expect(await board.elements()).toMatchObject([{ type: 'shape', shape: 'rect' }]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await trace();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ ...vertices[0], id: 0 }, { ...vertices[2], id: 1 }],
  });
  await page.clock.runFor(600);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await board.count()).toBe(1);
});
