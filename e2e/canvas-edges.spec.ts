import { expect, test } from './fixtures';

test('перетаскивание к краю прокручивает холст и удерживает объект под указателем', async ({ board, page }) => {
  await board.drag([{ x: 400, y: 300 }, { x: 500, y: 300 }]);
  await board.tool('v');
  await board.move({ x: 450, y: 300 });
  await page.mouse.down();
  const box = (await board.canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 8 });
  const before = await board.state();
  const first = (await board.elements())[0].pts[0].x;
  await expect.poll(async () => (await board.state()).camera.x).toBeGreaterThan(before.camera.x + 10);
  const after = await board.state();
  const second = (await board.elements())[0].pts[0].x;
  expect(Math.abs((second - first) - (after.camera.x - before.camera.x))).toBeLessThan(15);
  await page.mouse.up();
  const stopped = (await board.state()).camera.x;
  await page.waitForTimeout(150);
  expect((await board.state()).camera.x).toBe(stopped);
  await page.keyboard.press('Control+z');
  expect((await board.elements())[0].pts[0].x).toBeCloseTo(400, 0);
});

test('открывающиеся края появляются в первом кадре панорамы и уменьшения', async ({ page }) => {
  const pixels = await page.evaluate(async () => {
    const app = (window as any).__doska;
    const canvas = document.querySelector<HTMLCanvasElement>('#board')!;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const sample = (x: number, y: number) => Array.from(ctx.getImageData(
      Math.floor(x * canvas.width / w), Math.floor(y * canvas.height / h), 1, 1).data);
    const note = (id: string, x: number, y: number) => ({
      id, type: 'note', x, y, w: 80, h: 80, color: '#ff0000', text: '',
    });
    app.state.board.grid = 'none';
    app.state.board.elements = [
      ...Array.from({ length: 500 }, (_, i) => note(`distant-${i}`, 100000 + i * 100, 100000)),
      note('pan-edge', w + 20, 100), note('zoom-edge', w * 1.5, 200),
    ];
    app.state.camera = { x: 0, y: 0, zoom: 1 };
    app.requestRender();
    await frame();
    // Let the initial cache settle before each camera change.
    await new Promise(resolve => setTimeout(resolve, 180));
    await frame();
    app.state.camera = { x: 100, y: 0, zoom: 1 };
    app.requestRender();
    await frame();
    const pan = sample(w - 40, 130);
    await new Promise(resolve => setTimeout(resolve, 180));
    await frame();
    app.state.camera = { x: 0, y: 0, zoom: 0.5 };
    app.requestRender();
    await frame();
    const zoom = sample(w * 0.75 + 15, 115);
    return { pan, zoom };
  });
  for (const pixel of [pixels.pan, pixels.zoom]) {
    expect(pixel[0]).toBeGreaterThan(220);
    expect(pixel[1]).toBeLessThan(80);
    expect(pixel[2]).toBeLessThan(80);
  }
});
