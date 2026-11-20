// Правая боковая панель (SPEC_CHAT §5): кнопка ЧУ «вливается» в кнопку закрытия, переключатель режимов,
// F1 — «Справка», закрытие кнопкой и Esc, лист на узком окне.
import { expect, test } from './fixtures';

test.describe('боковая панель', () => {
  test('ЧУ открывает панель, переключатель режимов, F1, закрытие кнопкой и Esc', async ({ board, page }) => {
    const panel = page.locator('#side-panel');
    const close = page.locator('#side-panel-close');
    const notify = page.locator('#btn-notify');
    const mode = panel.locator('.sp-mode');
    await page.evaluate(() => (window as any).__doska.notify({ title: 'Капибара', body: 'присоединился к доске', icon: 'join' }));
    await expect(page.locator('#notify-stack .ns-card')).toBeVisible();

    await notify.click();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('role', 'complementary');
    await expect(close).toBeVisible();
    await expect(notify).toBeHidden(); // «влилась» в кнопку закрытия
    await expect(notify).toHaveAttribute('aria-expanded', 'true');
    await expect(mode).toHaveAttribute('data-value', 'notify');
    await expect(page.locator('#notify-stack')).toBeHidden(); // открыта панель ЧУ — стопки нет
    // кнопка закрытия — язычок, прикреплённый к панели слева (заходит на её рамку на 1 px), на 8 px ниже верха панели
    await expect.poll(async () => {
      const p = (await panel.boundingBox())!;
      const c = (await close.boundingBox())!;
      return [Math.round(p.x - (c.x + c.width)), Math.round(c.y - p.y), Math.round(c.width), Math.round(p.width)];
    }).toEqual([-1, 8, 33, 360]);
    // шапка уехала влево: «Поделиться» левее кнопки закрытия
    const share = (await page.locator('#btn-share').boundingBox())!;
    expect(share.x + share.width).toBeLessThan((await close.boundingBox())!.x);

    // переключатель → «История изменений»: кнопка ЧУ снова видна слева от кнопки закрытия
    await mode.click();
    await page.locator('.ss-menu [data-value="history"]').click();
    await expect(mode).toHaveAttribute('data-value', 'history');
    await expect(notify).toBeVisible();
    await expect(notify).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => {
      const n = (await notify.boundingBox())!;
      const c = (await close.boundingBox())!;
      return Math.round(c.x - (n.x + n.width));
    }).toBe(12);
    // щелчок по ЧУ — снова режим ЧУ
    await notify.click();
    await expect(mode).toHaveAttribute('data-value', 'notify');
    await expect(notify).toBeHidden();

    // F1 — «Справка», повторный F1 — закрывает
    await page.keyboard.press('F1');
    await expect(mode).toHaveAttribute('data-value', 'help');
    await expect(page.locator('#btn-help')).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.locator('.pv-help')).toBeVisible();
    await page.keyboard.press('F1');
    await expect(panel).toBeHidden();
    await expect(page.locator('#btn-help')).toHaveAttribute('aria-expanded', 'false');

    // кнопка закрытия и Esc закрывают; фокус — на кнопку ЧУ
    await page.locator('#btn-help').click();
    await expect(panel).toBeVisible();
    await close.click();
    await expect(panel).toBeHidden();
    await expect(close).toBeHidden();
    await expect(notify).toBeVisible();
    await notify.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(notify).toBeFocused();
    void board;
  });

  test('узкое окно: панель — лист под шапкой, кнопка закрытия в шапке панели, шапка доски на месте', async ({ board, page }) => {
    await page.setViewportSize({ width: 700, height: 800 });
    const share0 = (await page.locator('#btn-share').boundingBox())!;
    await page.keyboard.press('F1');
    const panel = page.locator('#side-panel');
    await expect(panel).toBeVisible();
    await expect.poll(async () => {
      const p = (await panel.boundingBox())!;
      return [Math.round(p.x), Math.round(p.y), Math.round(p.width), Math.round(p.height)];
    }).toEqual([12, 68, 676, 720]);
    const p = (await panel.boundingBox())!;
    const c = (await page.locator('#side-panel-close').boundingBox())!;
    expect(c.x).toBeGreaterThan(p.x);
    expect(c.x + c.width).toBeLessThan(p.x + p.width);
    expect(c.y).toBeGreaterThan(p.y);
    expect(c.y + c.height).toBeLessThan(p.y + 60);
    const share1 = (await page.locator('#btn-share').boundingBox())!;
    expect(Math.round(share1.x)).toBe(Math.round(share0.x));
    await page.locator('#side-panel-close').click();
    await expect(panel).toBeHidden();
    void board;
  });
});
