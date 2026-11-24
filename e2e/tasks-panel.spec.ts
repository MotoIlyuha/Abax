import { expect, test } from './fixtures';
import { test as collaboration } from './host';

test('кнопка под меню и взаимоисключение панелей', async ({ board, page }) => {
  const button = page.locator('#btn-tasks');
  const menu = page.locator('#btn-home');
  const panel = page.locator('#side-panel');
  await expect(button).toBeVisible();
  const a = (await menu.boundingBox())!;
  const b = (await button.boundingBox())!;
  expect(Math.abs(a.x - b.x)).toBeLessThan(1);
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  expect(b.width).toBe(a.width);
  const toolbarX = (await page.locator('#toolbar').boundingBox())!.x;
  await button.click();
  await expect(button).toHaveAttribute('aria-label', 'Свернуть панель');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.locator('#tasks-panel-body')).toContainText('Здесь появится банк заданий ОГЭ/ЕГЭ');
  await expect.poll(async () => {
    const p = (await panel.boundingBox())!;
    const m = (await menu.boundingBox())!;
    const t = (await page.locator('#toolbar').boundingBox())!;
    return [Math.round(p.x), Math.round(m.x - a.x), Math.round(t.x - toolbarX)];
  }).toEqual([12, 372, 372]);
  await page.locator('#btn-notify').click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.locator('#tasks-panel-body')).toBeHidden();
  await expect(panel.locator('.sp-mode')).toBeVisible();
  await button.click();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  void board;
});

test('узкий экран: панель закрывается нажатием вне неё', async ({ board, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const button = page.locator('#btn-tasks');
  await button.click();
  await expect(page.locator('#tasks-panel-body')).toBeVisible();
  await page.mouse.click(10, 500);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  void board;
});

collaboration('у гостя нет кнопки заданий', async ({ host, join }) => {
  const guest = await join(await host.share(), 'Ученик');
  await expect(guest.page.locator('body')).toHaveClass(/collab-guest/);
  await expect(guest.page.locator('#btn-tasks')).toBeHidden();
});

test('верхняя панель помещается между открытой панелью и краем окна', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const button = page.locator('#btn-tasks');
  const notify = page.locator('#btn-notify');
  const menu = page.locator('#btn-home');
  const panel = page.locator('#side-panel');
  await button.click();
  const left = (await panel.boundingBox())!;
  const home = (await menu.boundingBox())!;
  const chat = (await notify.boundingBox())!;
  expect(home.x).toBeGreaterThanOrEqual(left.x + left.width);
  expect(chat.x + chat.width).toBeLessThanOrEqual(820);
  await expect(page.locator('.export-group')).toBeHidden();
  await notify.click();
  await expect(panel).not.toHaveClass(/sp-left/);
  const right = (await panel.boundingBox())!;
  const share = (await page.locator('#btn-share').boundingBox())!;
  expect(share.x + share.width).toBeLessThanOrEqual(right.x);
  await button.click();
  await expect(panel).toHaveClass(/sp-left/);
});
