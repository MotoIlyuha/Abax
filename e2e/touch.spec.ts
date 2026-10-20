import { expect, test } from './fixtures';

// настоящие касания через CDP: Chromium сам превращает их в pointer-события с pointerType 'touch'
test.use({ hasTouch: true });

type Touch = { x: number; y: number; id: number };

test.describe('сенсорный экран', () => {
  test('щипок двумя пальцами масштабирует, после жеста оставшийся палец не рисует', async ({ board, page }) => {
    const cdp = await page.context().newCDPSession(page);
    const box = (await board.canvas.boundingBox())!;
    const at = (x: number, y: number, id: number): Touch => ({ x: box.x + x, y: box.y + y, id });
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Touch[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });

    await send('touchStart', [at(500, 400, 0)]);
    await send('touchStart', [at(500, 400, 0), at(600, 400, 1)]);
    for (let i = 1; i <= 5; i++) await send('touchMove', [at(500 - i * 20, 400, 0), at(600 + i * 20, 400, 1)]);
    // первый палец успел начать штрих — жест его отменяет, точка на доске не остаётся
    expect(await board.count()).toBe(0);
    const cam = (await board.state()).camera;
    expect(cam.zoom).toBeCloseTo(3, 1); // расстояние 100 → 300
    // середина жеста осталась на месте сцены
    expect((550) / cam.zoom + cam.x).toBeCloseTo(550, 0);

    // отпустили один палец и ведём вторым — это не рисование
    await send('touchEnd', [at(400, 400, 0)]);
    await send('touchMove', [at(400, 450, 0)]);
    await send('touchMove', [at(400, 500, 0)]);
    await send('touchEnd', []);
    expect(await board.count()).toBe(0);

    // обычное касание одним пальцем снова рисует
    await send('touchStart', [at(300, 300, 2)]);
    await send('touchMove', [at(350, 320, 2)]);
    await send('touchMove', [at(400, 340, 2)]);
    await send('touchEnd', []);
    expect(await board.count('stroke')).toBe(1);
  });
});
