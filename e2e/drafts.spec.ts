import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const draftCount = (page: Page) => page.evaluate(() => (window as any).__doska.state.drafts.length as number);
const onDraft = (page: Page) => page.evaluate(() => {
  const s = (window as any).__doska.state;
  return s.drafts.some((d: any) => d.id === s.pageId);
});

test.describe('черновик', () => {
  test('Alt+Shift+N создаёт черновик справа от страниц, за разделителем; в проект он не попадает', async ({ board, page }) => {
    await board.rect(100, 100, 200, 200);
    await board.openPages();
    await page.keyboard.press('Alt+Shift+KeyN');
    await expect.poll(() => draftCount(page)).toBe(1);
    expect(await onDraft(page)).toBe(true);
    await expect(page.locator('#draft-badge')).toBeVisible();
    await expect(page.locator('#page-name')).toHaveValue('Черновик');
    // в проекте всё по-прежнему одна страница
    expect((await board.state()).project.pages).toHaveLength(1);

    // порядок в списке: страница, «+», разделитель, черновик
    const kinds = await page.locator('#pages-list > *').evaluateAll(els => els.map(e => e.className.split(' ').filter(c => /^page-/.test(c) && c !== 'page-item').join('') || (e.classList.contains('page-item') ? 'item' : '')));
    expect(kinds).toEqual(['item', 'page-add', 'page-divider', 'item']);
    await expect(page.locator('#pages-list .page-item.draft')).toHaveClass(/active/);
    const real = (await page.locator('#pages-list .page-item:not(.draft)').boundingBox())!;
    const draft = (await page.locator('#pages-list .page-item.draft').boundingBox())!;
    expect(draft.x).toBeGreaterThan(real.x + real.width);

    // рисуем в черновике: проект не «грязнеет»
    await board.saved();
    await board.rect(50, 50, 120, 120);
    expect(await board.count('shape')).toBe(1);
    expect((await board.state()).dirty).toBe(false);
    expect((await board.state()).project.pages[0].count).toBe(1);
  });

  test('при перезагрузке черновик пропадает, страницы остаются', async ({ board, page }) => {
    await board.rect(100, 100, 200, 200);
    await board.saved();
    await page.keyboard.press('Alt+Shift+KeyN');
    await expect.poll(() => draftCount(page)).toBe(1);
    await board.rect(10, 10, 80, 80);
    await page.reload();
    await board.ready();
    expect(await draftCount(page)).toBe(0);
    expect(await board.count('shape')).toBe(1);
    expect((await board.state()).project.pages).toHaveLength(1);
  });

  test('с зажатым Alt кнопка «+» становится «Создать черновик», Alt+клик создаёт черновик', async ({ board, page }) => {
    await board.addPage();
    const tile = page.locator('#pages-list .page-add');
    await expect(tile).not.toHaveClass(/draft-mode/);
    await page.keyboard.down('Alt');
    await expect(tile).toHaveClass(/draft-mode/);
    await expect(tile).toContainText('Создать черновик');
    await tile.click();
    await page.keyboard.up('Alt');
    await expect.poll(() => draftCount(page)).toBe(1);
    expect((await board.state()).project.pages).toHaveLength(2);
    await expect(tile).not.toHaveClass(/draft-mode/);
  });

  test('«Страница +» с зажатым Alt тоже создаёт черновик', async ({ board, page }) => {
    const btn = page.locator('#btn-pages');
    await page.keyboard.down('Alt');
    await expect(btn).toHaveText('Черновик');
    await btn.click();
    await page.keyboard.up('Alt');
    await expect.poll(() => draftCount(page)).toBe(1);
    expect((await board.state()).project.pages).toHaveLength(1);
  });

  test('долгое нажатие на «+» (планшет) создаёт черновик, обычный клик — страницу', async ({ board, page }) => {
    await board.addPage();
    const tile = page.locator('#pages-list .page-add');
    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(tile).toHaveClass(/draft-mode/);
    await expect.poll(() => draftCount(page)).toBe(1);
    await page.mouse.up();
    // клик, которым закончилось нажатие, страницу не добавил
    expect((await board.state()).project.pages).toHaveLength(2);
    await expect(tile).not.toHaveClass(/draft-mode/);
    // короткое нажатие — по-прежнему страница
    await tile.click();
    await expect.poll(async () => (await board.state()).project.pages.length).toBe(3);
    expect(await draftCount(page)).toBe(1);
  });

  test('черновик нельзя перетащить на холст как страницу и переставить среди страниц', async ({ board, page }) => {
    await page.evaluate(() => {
      // раздел «Экспериментальные»: страницы на холсте
      (window as any).__doska.state.settings.pageLinks = true;
    });
    await board.addPage();
    await page.keyboard.press('Alt+Shift+KeyN');
    await expect.poll(() => draftCount(page)).toBe(1);
    const card = page.locator('#pages-list .page-item.draft');
    const a = (await card.boundingBox())!;
    const canvas = (await board.canvas.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 3);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 400, canvas.y + 300, { steps: 12 });
    await page.mouse.up();
    expect(await board.count('image')).toBe(0);
    // и порядок страниц не изменился, черновик остался крайним справа
    const names = await page.locator('#pages-list .page-item .page-name').allTextContents();
    expect(names).toEqual(['Страница 1', 'Страница 2', 'Черновик']);
  });

  test('удаление: пустой черновик — сразу, с содержимым — после подтверждения; открытый возвращает на страницу', async ({ board, page }) => {
    await board.rect(100, 100, 200, 200);
    await board.openPages();
    await page.keyboard.press('Alt+Shift+KeyN');
    await expect.poll(() => draftCount(page)).toBe(1);
    const card = page.locator('#pages-list .page-item.draft');
    await card.hover();
    await card.locator('.page-del').click();
    await expect.poll(() => draftCount(page)).toBe(0);
    expect(await board.count('shape')).toBe(1);

    await page.keyboard.press('Alt+Shift+KeyN');
    await expect.poll(() => draftCount(page)).toBe(1);
    await board.rect(10, 10, 80, 80);
    page.once('dialog', d => { expect(d.message()).toContain('Удалить черновик'); void d.dismiss(); });
    await card.hover();
    await card.locator('.page-del').click();
    expect(await draftCount(page)).toBe(1);
    page.once('dialog', d => void d.accept());
    await card.hover();
    await card.locator('.page-del').click();
    await expect.poll(() => draftCount(page)).toBe(0);
    expect(await board.count('shape')).toBe(1);
  });

  test('в окне демонстрации остаётся страница, на которой были до черновика', async ({ board, page }) => {
    await board.rect(100, 100, 220, 220);
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#btn-present').click()]);
    await expect.poll(() => popup.evaluate(() => document.querySelector('canvas')?.width ?? 0)).toBeGreaterThan(0);
    const inkOf = () => popup.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) n++;
      return n;
    });
    await expect.poll(inkOf).toBeGreaterThan(100);
    const before = await inkOf();

    await board.openPages();
    await page.keyboard.press('Alt+Shift+KeyN');
    await expect.poll(() => draftCount(page)).toBe(1);
    // в черновике рисуем другой фигурой — зрители её не видят, прежняя страница на месте
    await board.rect(300, 300, 520, 520);
    await board.settled();
    expect(Math.abs((await inkOf()) - before)).toBeLessThan(before * 0.05);

    await page.locator('#pages-list .page-item:not(.draft)').click();
    await board.settled();
    expect(Math.abs((await inkOf()) - before)).toBeLessThan(before * 0.05);
  });
});
