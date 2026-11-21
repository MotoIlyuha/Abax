import { expect, test } from './fixtures';

test.describe('откреплённая панель инструментов', () => {
  test('по умолчанию ручки нет; включается в «Дополнительных»', async ({ page }) => {
    const grip = page.locator('#toolbar .tb-grip');
    await page.locator('#toolbar').hover();
    await expect(grip).toBeHidden();
    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-nav-item[data-section="advanced"]').click();
    const check = page.getByLabel('Разрешить откреплять панель инструментов');
    await expect(check).not.toBeChecked();
    await check.check();
    await page.keyboard.press('Escape');
    await page.locator('#toolbar').hover();
    await expect(grip).toBeVisible();
    await expect(grip).toHaveCSS('opacity', '1');
  });

  test('нажатие на ручку поворачивает панель, перенос вниз - тоже, выключение возвращает к краю', async ({ board, page }) => {
    await page.evaluate(() => localStorage.setItem('doska.settings', JSON.stringify({ toolbarPos: 'left', toolbarDetachable: true })));
    await page.reload();
    await board.ready();
    const tb = page.locator('#toolbar');
    const grip = tb.locator('.tb-grip');
    await tb.hover();
    await expect(grip).toHaveCSS('opacity', '1');
    const v = (await tb.boundingBox())!;
    expect(v.height).toBeGreaterThan(v.width);

    // простое нажатие: колонка → строка (у края экрана — прижата к нему)
    await grip.click({ position: { x: 20, y: 6 } });
    await expect(tb).toHaveClass(/floating/);
    await expect(tb).toHaveAttribute('data-pos', 'top');
    const h = (await tb.boundingBox())!;
    expect(h.width).toBeGreaterThan(h.height);
    expect((await board.state()).settings.toolbarFloat).toMatchObject({ orient: 'h' });

    // обратно в колонку и вниз: внизу колонка не помещается — становится строкой
    await tb.hover();
    await grip.click({ position: { x: 20, y: 6 } });
    await expect(tb).toHaveAttribute('data-pos', 'left');
    await tb.hover();
    const g2 = (await grip.boundingBox())!;
    await page.mouse.move(g2.x + g2.width / 2, g2.y + 6);
    await page.mouse.down();
    await page.mouse.move(700, 600, { steps: 8 });
    await page.mouse.move(720, 800, { steps: 8 });
    await page.mouse.up();
    await expect(tb).toHaveAttribute('data-pos', 'bottom');
    const moved = (await tb.boundingBox())!;
    expect(moved.width).toBeGreaterThan(moved.height);
    expect(moved.y + moved.height).toBeLessThanOrEqual(900);
    // место запомнилось
    await page.reload();
    await board.ready();
    await expect(tb).toHaveClass(/floating/);
    await expect(tb).toHaveAttribute('data-pos', 'bottom');

    // удержание ручки прикрепляет панель обратно к краю; подсказка ручки — обычный пузырь,
    // а подсветка кнопок («Улучшенные» анимации) её не накрывает
    await tb.hover();
    const g3 = (await grip.boundingBox())!;
    await page.mouse.move(g3.x + g3.width / 2, g3.y + 6);
    await expect(page.locator('#tooltip')).toContainText('удерживайте - прикрепить обратно');
    await expect(page.locator('#toolbar .mt-hl')).toHaveCSS('opacity', '0');
    await page.mouse.down();
    await expect(tb).not.toHaveClass(/floating/);
    await page.mouse.up();
    await expect(tb).toHaveAttribute('data-pos', 'left');
    expect((await board.state()).settings.toolbarFloat).toBeNull();

    // Запрет открепления в «Дополнительных» возвращает панель к сохранённому краю.
    await tb.hover();
    await grip.click({ position: { x: 20, y: 6 } });
    await expect(tb).toHaveClass(/floating/);
    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-nav-item[data-section="advanced"]').click();
    await page.getByLabel('Разрешить откреплять панель инструментов').uncheck();
    await expect(tb).not.toHaveClass(/floating/);
    await expect(tb).toHaveAttribute('data-pos', 'left');
    expect((await board.state()).settings.toolbarFloat).toBeNull();
  });
});
