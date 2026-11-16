import { expect, test } from './fixtures';

// Goo-эффект групп панели инструментов: капли выливаются из кнопки группы и втягиваются обратно.
test.describe('Motion: Goo групп панели', () => {
  test('открытие: слой Goo появляется и исчезает, панель встаёт на место без обрезки', async ({ page }) => {
    await page.locator('#btn-shapes').click();
    const panel = page.locator('.ctx-panel[data-kind="shapes"]');
    await expect(panel).toBeVisible();
    await expect(page.locator('#goo-layer .goo-fx')).toHaveCount(1);
    // капель столько же, сколько инструментов в группе
    await expect(page.locator('#goo-layer .goo-drop')).toHaveCount(await panel.locator('.ctx-shapes .tool').count());
    await expect(page.locator('#goo-layer .goo-fx')).toHaveCount(0, { timeout: 4000 });
    expect(await panel.evaluate(el => (el as HTMLElement).style.maskImage)).toBe('');
    expect(await panel.locator('.ctx-shapes .tool').first().evaluate(el => (el as HTMLElement).style.opacity)).toBe('');
    // панель работает: выбор инструмента закрывает её
    await panel.locator('[data-shape="ellipse"]').click();
    await expect(page.locator('.ctx-panel')).toHaveCount(0);
  });

  test('закрытие: панель убирается сразу, «призрак» втягивается в кнопку и пропадает', async ({ page }) => {
    await page.locator('#btn-shapes').click();
    await expect(page.locator('#goo-layer .goo-fx')).toHaveCount(0, { timeout: 4000 });
    await page.locator('#btn-shapes').click();
    // настоящей панели уже нет, остался «призрак» — копия, которая втягивается
    await expect(page.locator('.ctx-panel')).toHaveCount(0);
    await expect(page.locator('.goo-ghost')).toHaveCount(1);
    expect(await page.locator('.goo-ghost').evaluate(el => el.hasAttribute('inert'))).toBe(true);
    await expect(page.locator('.goo-ghost')).toHaveCount(0, { timeout: 4000 });
    await expect(page.locator('#goo-layer .goo-fx')).toHaveCount(0);
  });

  test('«Motion анимации» выключены: никакого Goo', async ({ page }) => {
    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-general label', { hasText: 'Motion анимации' }).locator('input').uncheck();
    await page.keyboard.press('Escape');
    await page.locator('#btn-shapes').click();
    await expect(page.locator('.ctx-panel[data-kind="shapes"]')).toBeVisible();
    await expect(page.locator('#goo-layer .goo-fx')).toHaveCount(0);
    await page.locator('#btn-shapes').click();
    await expect(page.locator('.ctx-panel')).toHaveCount(0);
  });

  test('внутри группы те же Motion hover и подсказка: подсветка и пузырь перетекают между кнопками', async ({ page }) => {
    await page.locator('#btn-solids').click();
    const panel = page.locator('.ctx-panel[data-kind="shapes"]');
    await expect(page.locator('#goo-layer .goo-fx')).toHaveCount(0, { timeout: 4000 });
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
