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

  test('карусель страниц на домашней листают пальцем, касание открывает показанную страницу', async ({ board, page }) => {
    await board.addPage();
    await board.addPage();
    await page.locator('#btn-home').click();
    const card = page.locator('#home .project-card');
    const name = card.locator('.carousel-name');
    await expect(name).toHaveText('Страница 3');
    const cdp = await page.context().newCDPSession(page);
    const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Touch[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const b = (await card.locator('.project-preview').boundingBox())!;
    const y = b.y + b.height / 2;
    const swipe = async (from: number, to: number, id: number) => {
      await send('touchStart', [{ x: b.x + b.width * from, y, id }]);
      for (let i = 1; i <= 6; i++) await send('touchMove', [{ x: b.x + b.width * (from + (to - from) * i / 6), y, id }]);
      await send('touchEnd', []);
    };

    // вправо — к предыдущей, влево — к следующей; смахивание проект не открывает
    await swipe(0.3, 0.8, 1);
    await expect(name).toHaveText('Страница 2');
    await swipe(0.3, 0.8, 2);
    await expect(name).toHaveText('Страница 1');
    await swipe(0.8, 0.3, 3);
    await expect(name).toHaveText('Страница 2');
    await expect(page.locator('#home')).toBeVisible();

    // касание — открыть. Сразу после смахивания Chromium касание кликом не считает (оно гасит инерцию) — ждём
    await page.waitForTimeout(600);
    await send('touchStart', [{ x: b.x + b.width / 2, y, id: 4 }]);
    await send('touchEnd', []);
    await expect(page.locator('#home')).toBeHidden();
    await expect(page.locator('#page-name')).toHaveValue('Страница 2');
  });

  for (const [tool, key, cls] of [['стикер', 'n', '.inplace-edit.note'], ['текст', 't', '.inplace-edit']] as const) {
    test(`касание пальцем создаёт ${tool}: поле ввода не пропадает сразу`, async ({ board, page }) => {
      const cdp = await page.context().newCDPSession(page);
      const box = (await board.canvas.boundingBox())!;
      const tap = async (x: number, y: number) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + x, y: box.y + y, id: 0 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      await board.tool(key);
      await tap(500, 400);
      // после касания браузер шлёт эмулированные mousedown и click — они не должны снимать фокус
      await page.waitForTimeout(400);
      const editor = page.locator(cls);
      await expect(editor).toBeVisible();
      await expect(editor).toBeFocused();
      await page.keyboard.type('Задача 1');
      await page.keyboard.press('Enter');
      await expect(editor).toHaveCount(0);
      expect(await board.count(tool === 'стикер' ? 'note' : 'text')).toBe(1);
    });
  }

  test('касание холста снимает фокус с поля названия страницы', async ({ board, page }) => {
    const cdp = await page.context().newCDPSession(page);
    const box = (await board.canvas.boundingBox())!;
    const name = page.locator('#page-name');
    await name.fill('Геометрия');
    await expect(name).toBeFocused();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 500, y: box.y + 400, id: 0 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(name).not.toBeFocused();
    expect((await board.state()).project.pages[0].name).toBe('Геометрия');
  });
});
