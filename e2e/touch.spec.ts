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

  test('страницу на домашней переставляют долгим нажатием пальца, короткое движение — прокрутка', async ({ board, page }) => {
    await page.locator('#btn-home').click();
    const card = page.locator('#home .project-card');
    await card.locator('.home-add-page').click();
    await card.locator('.home-add-page').click();
    const names = card.locator('.home-page-name');
    await expect(names).toHaveText(['Страница 1', 'Страница 2', 'Страница 3']);
    const cdp = await page.context().newCDPSession(page);
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Touch[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const center = async (i: number) => {
      const b = (await card.locator('.home-page').nth(i).boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 3 };
    };

    // сразу повели пальцем — перетаскивания нет
    let a = await center(0);
    let b = await center(2);
    await send('touchStart', [{ ...a, id: 0 }]);
    for (let i = 1; i <= 8; i++) await send('touchMove', [{ x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8, id: 0 }]);
    await send('touchEnd', []);
    await expect(names).toHaveText(['Страница 1', 'Страница 2', 'Страница 3']);

    // подержали — карточка поехала за пальцем
    a = await center(0);
    b = await center(2);
    await send('touchStart', [{ ...a, id: 1 }]);
    await page.waitForTimeout(500);
    for (let i = 1; i <= 8; i++) await send('touchMove', [{ x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8, id: 1 }]);
    await send('touchEnd', []);
    await expect(names).toHaveText(['Страница 2', 'Страница 3', 'Страница 1']);
    await expect(page.locator('#home')).toBeVisible();
    expect((await board.state()).project.pages.map(p => p.name)).toEqual(['Страница 2', 'Страница 3', 'Страница 1']);
  });
});
