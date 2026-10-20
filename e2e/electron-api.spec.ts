// Режим настольного приложения: доска работает через doskaAPI (preload Electron) —
// проекты хранятся не в localStorage, файлы выбираются и сохраняются системными диалогами.
import type { Page } from '@playwright/test';
import { expect, test } from './host';

async function pngDataUrl(page: Page, w: number, h: number): Promise<string> {
  return page.evaluate(([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.fillRect(0, 0, w, h);
    return c.toDataURL('image/png');
  }, [w, h]);
}

test.describe('режим Electron (doskaAPI)', () => {
  test('проекты сохраняются через API, а не в localStorage', async ({ host, page }) => {
    await host.board.rect(400, 300, 500, 400);
    await host.board.saved();
    const [saved] = [...host.store.values()];
    expect(saved.name).toBe('Проект 1');
    expect(saved.pages[0].elements).toHaveLength(1);
    const lsKeys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('doska.p')));
    expect(lsKeys).toEqual([]);

    await page.reload();
    await host.board.ready();
    expect(await host.board.count()).toBe(1);
  });

  test('доска старого формата (без страниц) открывается как проект с одной страницей', async ({ host, page }) => {
    host.store.clear();
    host.store.set('legacy', {
      id: 'legacy', name: 'Старая доска', createdAt: 1, updatedAt: Date.now() + 1000, grid: 'dots',
      elements: [{ id: 'e1', type: 'shape', shape: 'ellipse', x: 0, y: 0, w: 50, h: 50, color: '#000000', width: 2 }],
    });
    await page.evaluate(() => localStorage.removeItem('doska.last'));
    await page.reload();
    await host.board.ready();
    const s = await host.board.state();
    expect(s.project.name).toBe('Старая доска');
    expect(s.project.pages).toEqual([expect.objectContaining({ name: 'Страница 1', grid: 'dots', count: 1 })]);
  });

  test('экспорт PNG — через диалог сохранения', async ({ host, page }) => {
    await host.board.rect(400, 300, 500, 400);
    await page.keyboard.press('Control+e');
    await expect.poll(() => host.exports.length).toBe(1);
    expect(host.exports[0].name).toBe('Проект 1 — Страница 1.png');
    expect(host.exports[0].dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  test('картинка из диалога открытия; отмена ничего не добавляет', async ({ host, page }) => {
    await page.locator('#btn-image').click();
    expect(await host.board.count()).toBe(0);
    host.nextImage = await pngDataUrl(page, 120, 80);
    await page.locator('#btn-image').click();
    await expect.poll(() => host.board.count('image')).toBe(1);
    expect((await host.board.elements())[0]).toMatchObject({ w: 120, h: 80 });
  });

  test('PDF из диалога открытия', async ({ host, page, browser }) => {
    const gen = await browser.newPage();
    await gen.setContent('<p>Контрольная</p>');
    host.nextPdf = 'data:application/pdf;base64,' + (await gen.pdf({ format: 'A6' })).toString('base64');
    await gen.close();
    await page.locator('#btn-import').click();
    await expect.poll(() => host.board.count('image'), { timeout: 15_000 }).toBe(1);
    // после импорта камера показывает всё содержимое
    expect((await host.board.state()).camera.zoom).toBeLessThan(1.5);
  });
});
