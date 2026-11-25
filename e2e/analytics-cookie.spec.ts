import { test, expect } from '@playwright/test';

for (const [choice, value, confirmation] of [
  ['Разрешить', 'accepted', 'Аналитика разрешена'],
  ['Отклонить', 'rejected', 'Аналитика отключена'],
] as const) {
  test(`баннер сохраняет выбор: ${choice}`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('abax.analytics-consent');
      localStorage.setItem('doska.profile', JSON.stringify({ onboarded: true }));
    });
    await page.goto('/');
    const banner = page.locator('#analytics-banner');
    await expect(banner).toBeVisible();
    await expect(banner.locator('.analytics-cookie-svg')).toBeVisible();
    await banner.getByRole('button', { name: choice }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('abax.analytics-consent'))).toBe(value);
    await expect(banner.getByRole('status')).toHaveText(confirmation);
    await expect(banner).toBeHidden({ timeout: 5000 });
  });
}
