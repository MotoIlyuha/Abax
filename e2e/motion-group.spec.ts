import { expect, test } from './fixtures';

// Motion групп панели инструментов: панель вытягивается из кнопки группы и втягивается обратно.
const transform = (page: import('@playwright/test').Page) =>
  page.locator('.ctx-panel[data-kind="shapes"]').evaluate(el => (el as HTMLElement).style.transform);

test.describe('Motion: вытягивание групп панели', () => {
  test('открытие: панель вытягивается из кнопки и встаёт на место без трансформаций', async ({ page }) => {
    await page.locator('#btn-shapes').click();
    const panel = page.locator('.ctx-panel[data-kind="shapes"]');
    await expect(panel).toBeVisible();
    expect(await transform(page)).toContain('scale');
    await expect.poll(() => transform(page), { timeout: 4000 }).toBe('');
    expect(await panel.evaluate(el => (el as HTMLElement).style.opacity)).toBe('');
    expect(await panel.locator('.ctx-shapes .tool').first().evaluate(el => (el as HTMLElement).style.opacity)).toBe('');
    // панель работает: выбор инструмента закрывает её
    await panel.locator('[data-shape="ellipse"]').click();
    await expect(page.locator('.ctx-panel')).toHaveCount(0);
  });

  test('закрытие: панель убирается сразу, «призрак» втягивается в кнопку и пропадает', async ({ page }) => {
    await page.locator('#btn-shapes').click();
    await expect.poll(() => transform(page), { timeout: 4000 }).toBe('');
    await page.locator('#btn-shapes').click();
    await expect(page.locator('.ctx-panel')).toHaveCount(0);
    await expect(page.locator('.stretch-ghost')).toHaveCount(1);
    expect(await page.locator('.stretch-ghost').evaluate(el => el.hasAttribute('inert'))).toBe(true);
    await expect(page.locator('.stretch-ghost')).toHaveCount(0, { timeout: 4000 });
  });

  test('«Motion анимации» выключены: без вытягивания', async ({ page }) => {
    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-general label', { hasText: 'Motion анимации' }).locator('input').uncheck();
    await page.keyboard.press('Escape');
    await page.locator('#btn-shapes').click();
    await expect(page.locator('.ctx-panel[data-kind="shapes"]')).toBeVisible();
    expect(await transform(page)).toBe('');
    await page.locator('#btn-shapes').click();
    await expect(page.locator('.ctx-panel')).toHaveCount(0);
    await expect(page.locator('.stretch-ghost')).toHaveCount(0);
  });

  test('внутри группы те же Motion hover и подсказка: подсветка и пузырь перетекают между кнопками', async ({ page }) => {
    await page.locator('#btn-solids').click();
    const panel = page.locator('.ctx-panel[data-kind="shapes"]');
    await expect.poll(() => transform(page), { timeout: 4000 }).toBe('');
    const tools = panel.locator('.ctx-shapes .tool');
    await tools.nth(0).hover();
    const lab = page.locator('#morph-tip .mt-lab.cur');
    await expect(lab).toContainText('Куб');
    await expect(page.locator('#morph-tip .mt-tip')).toBeVisible();
    // подсветка лежит в сетке группы, а не в панели инструментов
    await expect(panel.locator('.ctx-shapes > .mt-hl')).toHaveCount(1);
    await tools.nth(1).hover();
    await expect(lab).toContainText('Параллелепипед');
    await expect(page.locator('#morph-tip .mt-tip')).toBeVisible();
    // обычного пузыря нет
    await expect(page.locator('#tooltip')).toBeHidden();
    // уход с панели — подсказка уходит
    await page.mouse.move(900, 300);
    await expect(page.locator('#morph-tip .mt-tip')).toBeHidden();
  });
});
