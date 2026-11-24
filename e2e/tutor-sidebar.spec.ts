import { test, expect } from '@playwright/test';
import { skipOnboarding } from './fixtures';

test('боковая панель сворачивается и переключает разделы при ширине 791 пиксель', async ({ page }) => {
  await page.setViewportSize({ width: 791, height: 881 });
  await skipOnboarding(page.context());
  await page.goto('/?route=tutor');
  const rail = page.getByRole('navigation', { name: 'Разделы кабинета' });
  const collapse = rail.getByRole('button', { name: 'Свернуть боковую панель' });
  await expect(collapse).toBeVisible();
  const highlight = rail.locator('.tu-sidebar-highlight');
  const before = await highlight.evaluate(el => el.getBoundingClientRect().y);
  await rail.getByRole('button', { name: 'Ученики' }).click();
  await expect(page.getByRole('heading', { name: 'Ученики' })).toBeVisible();
  await expect.poll(async () => (await highlight.boundingBox())!.y).toBeGreaterThan(before + 20);
  await collapse.click();
  await expect(rail.getByRole('button', { name: 'Развернуть боковую панель' })).toBeVisible();
  await expect.poll(async () => (await rail.boundingBox())!.width).toBeLessThan(65);
  await rail.getByRole('button', { name: 'Развернуть боковую панель' }).click();
  await expect.poll(async () => (await rail.boundingBox())!.width).toBeGreaterThan(161);
  await page.setViewportSize({ width: 390, height: 881 });
  await expect(collapse).toBeHidden();
});

test('подсветка и стрелка выровнены по своим кнопкам', async ({ page }) => {
  await page.setViewportSize({ width: 937, height: 881 });
  await skipOnboarding(page.context());
  await page.goto('/?route=tutor');
  const rail = page.getByRole('navigation', { name: 'Разделы кабинета' });
  const students = rail.getByRole('button', { name: 'Ученики' });
  await students.click();
  const highlight = rail.locator('.tu-sidebar-highlight');
  await expect.poll(async () => {
    const button = await students.boundingBox(), background = await highlight.boundingBox();
    return button && background ? Math.abs(button.y - background.y) + Math.abs(button.height - background.height) : 100;
  }).toBeLessThan(1);
  const toggle = rail.getByRole('button', { name: 'Свернуть боковую панель' });
  const button = await toggle.boundingBox(), arrow = await toggle.locator('.tu-sidebar-chevron').boundingBox();
  expect(Math.abs((button!.y + button!.height / 2) - (arrow!.y + arrow!.height / 2))).toBeLessThan(1);
  await expect(rail.locator('.tu-brand img')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});
