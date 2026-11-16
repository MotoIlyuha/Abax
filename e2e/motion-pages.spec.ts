import { expect, test } from './fixtures';

// Motion на панели страниц: рамка выбранной страницы, раскрытие списка на пружинах, переключатель «Motion анимации».
test.describe('Motion: панель страниц', () => {
  test.beforeEach(async ({ page }) => {
    await page.locator('#btn-pages').click(); // «Страница +»: вторая страница, список открывается
    await expect(page.locator('#pages-list .page-item')).toHaveCount(2);
    await page.locator('#pages-list .page-add').click(); // третья
    await expect(page.locator('#pages-list .page-item')).toHaveCount(3);
  });

  test('рамка выбранной страницы перетекает к карточке и встаёт ровно на неё', async ({ page }) => {
    const ring = () => page.locator('#pages-list').evaluate(list => {
      const cs = getComputedStyle(list, '::before');
      const m = new DOMMatrix(cs.transform);
      return { x: m.m41, y: m.m42, w: parseFloat(cs.width), h: parseFloat(cs.height), o: parseFloat(cs.opacity) };
    });
    const card = (i: number) => page.locator('#pages-list .page-item').nth(i).evaluate(el => {
      const e = el as HTMLElement;
      return { x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight };
    });
    await page.locator('#pages-list .page-item').first().click();
    await expect(page.locator('#pages-list .page-item').first()).toHaveClass(/active/);
    await expect.poll(async () => { const r = await ring(), c = await card(0); return Math.abs(r.x - c.x) + Math.abs(r.w - 4 - c.w); }).toBeLessThan(1.5);
    expect((await ring()).o).toBe(1);
    // у карточки своей рамки нет — акцентный цвет только у общей рамки
    const border = await page.locator('#pages-list .page-item').first().evaluate(el => getComputedStyle(el).borderTopColor);
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(accent).not.toBe('');
    expect(border).not.toBe('rgb(50, 115, 245)');

    await page.locator('#pages-list .page-item').nth(2).click();
    // по пути рамка растягивается: шире одной карточки
    let widest = 0;
    for (let i = 0; i < 25; i++) { widest = Math.max(widest, (await ring()).w); await page.waitForTimeout(16); }
    expect(widest).toBeGreaterThan((await card(2)).w + 8);
    await expect.poll(async () => { const r = await ring(), c = await card(2); return Math.abs(r.x - c.x) + Math.abs(r.w - 4 - c.w); }).toBeLessThan(1.5);
  });

  test('список закрывается и открывается на пружинах: лоток скрывается, когда всё успокоилось', async ({ page }) => {
    const dock = page.locator('#pages-dock');
    const tray = page.locator('#pages-tray');
    await expect(tray).toBeVisible();
    await page.keyboard.press('b');
    await expect(dock).not.toHaveClass(/\bopen\b/);
    await expect(tray).toBeHidden();
    await expect(dock).not.toHaveClass(/mt-showing/);
    // после успокоения инлайновые стили сняты — дальше работает обычный CSS
    expect(await tray.evaluate(el => (el as HTMLElement).style.transform)).toBe('');
    await page.keyboard.press('b');
    await expect(tray).toBeVisible();
    await expect.poll(() => page.locator('#btn-pages').evaluate(el => (el as HTMLElement).style.transform)).toBe('');
  });

  test('«Motion анимации» выключены: рамки нет, у карточки обычная рамка, список раскрывается как раньше', async ({ page }) => {
    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-general label', { hasText: 'Motion анимации' }).locator('input').uncheck();
    await page.keyboard.press('Escape');
    expect(await page.locator('#pages-list').evaluate(list => getComputedStyle(list, '::before').display)).toBe('none');
    const active = page.locator('#pages-list .page-item.active');
    // у карточки цвет рамки переходит плавно, поэтому ждём конца перехода
    await expect.poll(() => active.evaluate(el => getComputedStyle(el).borderTopColor)).toBe('rgb(50, 115, 245)');
    await page.keyboard.press('b');
    await expect(page.locator('#pages-tray')).toBeHidden();
    await page.keyboard.press('b');
    await expect(page.locator('#pages-tray')).toBeVisible();
    expect(await page.locator('#pages-dock').evaluate(el => el.classList.contains('mt-showing'))).toBe(false);
  });
});
