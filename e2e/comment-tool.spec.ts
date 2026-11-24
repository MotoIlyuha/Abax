import { expect, test } from './fixtures';

test('комментарий на холсте можно открыть, переместить и удалить', async ({ board, page }) => {
  const tool = page.locator('#toolbar [data-tool="comment"]');
  await tool.click();
  await expect(board.canvas).toHaveCSS('cursor', /^url\(/);

  await board.click({ x: 550, y: 380 });
  const editor = page.locator('.comment-pop textarea');
  await editor.fill('Комментарий к свободной области');
  await editor.press('Enter');
  const pin = page.locator('.an-pin');
  await expect(pin).toBeVisible();
  expect(await board.count()).toBe(0);

  await pin.click();
  await expect(page.getByRole('log')).toContainText('Комментарий к свободной области');
  await page.keyboard.press('Escape');
  await expect(page.locator('.comment-pop')).toHaveCount(0);
  const initial = (await pin.boundingBox())!;
  await page.mouse.move(initial.x + 12, initial.y + 12);
  await page.mouse.down();
  await page.mouse.move(initial.x + 92, initial.y + 57, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await pin.boundingBox())!.x - initial.x - 80)).toBeLessThan(2);
  await expect.poll(async () => Math.abs((await pin.boundingBox())!.y - initial.y - 45)).toBeLessThan(2);

  page.once('dialog', dialog => dialog.accept());
  await pin.click({ button: 'right' });
  await expect(pin).toHaveCount(0);
});

test('инструмент подсвечивает объект и подтверждает его удаление при нерешённом обсуждении', async ({ board, page }) => {
  await board.tool('r');
  await board.drag([{ x: 350, y: 320 }, { x: 530, y: 440 }]);
  const [shape] = await board.elements();
  expect(shape).toMatchObject({ type: 'shape', shape: 'rect' });

  await page.locator('#toolbar [data-tool="comment"]').click();
  const point = { x: shape.x + shape.w / 2, y: shape.y };
  await board.move(point);
  await expect.poll(() => page.evaluate(() => (window as any).__doska.state.commentHoverId)).toBe(shape.id);
  await board.click(point);
  const editor = page.locator('.comment-pop textarea');
  await editor.fill('Нужно проверить');
  await editor.press('Enter');
  await expect(page.locator('.an-pin')).toHaveCount(1);
  await page.keyboard.press('Escape');

  await board.tool('v');
  await board.click(point);
  page.once('dialog', dialog => dialog.dismiss());
  await page.keyboard.press('Delete');
  expect(await board.count()).toBe(1);
  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Delete');
  expect(await board.count()).toBe(0);

  await page.locator('#toolbar [data-tool="comment"]').click();
  await expect(page.locator('.an-pin')).toHaveCount(0);
});
