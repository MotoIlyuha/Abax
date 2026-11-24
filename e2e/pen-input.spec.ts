import { expect, test } from './fixtures';

test('стилус продолжает штрих при касании ладонью и сохраняет последнюю точку', async ({ board }) => {
  await board.canvas.evaluate((canvas: HTMLCanvasElement) => {
    // Synthetic pointer IDs are not registered by the browser for native capture.
    canvas.setPointerCapture = () => {};
    const r = canvas.getBoundingClientRect();
    const send = (type: string, pointerType: string, pointerId: number, x: number, y: number) => {
      canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, pointerId, clientX: r.left + x, clientY: r.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5 }));
    };
    send('pointerdown', 'pen', 1, 300, 300);
    send('pointermove', 'pen', 1, 350, 300);
    send('pointerdown', 'touch', 2, 450, 400);
    send('pointerdown', 'touch', 3, 500, 400);
    send('pointermove', 'touch', 2, 460, 400);
    send('pointermove', 'pen', 1, 400, 300);
    send('pointerup', 'touch', 2, 460, 400);
    send('pointerup', 'pen', 1, 400, 300);
    send('pointerup', 'touch', 3, 500, 400);
  });
  const strokes = await board.elements();
  expect(strokes).toHaveLength(1);
  expect(strokes[0].type).toBe('stroke');
  expect(strokes[0].pts.at(-1).x).toBeCloseTo(400);
  expect((await board.state()).camera.zoom).toBe(1);
});

test('стилус получает приоритет, если ладонь коснулась экрана первой', async ({ board }) => {
  await board.canvas.evaluate((canvas: HTMLCanvasElement) => {
    // Synthetic pointer IDs are not registered by the browser for native capture.
    canvas.setPointerCapture = () => {};
    const r = canvas.getBoundingClientRect();
    const send = (type: string, pointerType: string, pointerId: number, x: number, y: number) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, pointerId, clientX: r.left + x, clientY: r.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5 }));
    send('pointerdown', 'touch', 2, 450, 400);
    send('pointermove', 'touch', 2, 470, 400);
    send('pointerdown', 'pen', 1, 300, 300);
    send('pointermove', 'pen', 1, 400, 300);
    send('pointerup', 'pen', 1, 400, 300);
    send('pointerup', 'touch', 2, 470, 400);
  });
  const strokes = await board.elements();
  expect(strokes).toHaveLength(1);
  expect(strokes[0].pts[0].x).toBeCloseTo(300);
  expect(strokes[0].pts.at(-1).x).toBeCloseTo(400);
});

