import { test, expect } from '@playwright/test';
import { skipOnboarding } from './fixtures';

test('Мобильная навигация показывает выбранный раздел', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await skipOnboarding(page.context());
  await page.goto('/?route=tutor');
  const nav = page.getByRole('navigation', { name: 'Разделы кабинета' });
  const students = nav.getByRole('button', { name: 'Ученики' });
  await students.click();
  await expect(students).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Ученики' })).toBeVisible();
  await expect.poll(async () => {
    const button = await students.boundingBox();
    const highlight = await nav.locator('.tu-nav-highlight').boundingBox();
    return button && highlight ? Math.abs(button.x - highlight.x) + Math.abs(button.width - highlight.width) : 100;
  }).toBeLessThan(2);
  await expect(nav.getByRole('button', { name: 'Профиль' })).toBeVisible();
});
