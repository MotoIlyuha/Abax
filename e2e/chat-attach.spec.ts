// Чат: картинки и объекты доски между двумя «устройствами» (SPEC_CHAT §7; облачная комната настоящего сервера Abax).
// Автор прикрепляет картинку скрепкой — гость видит её в ленте и открывает просмотр; автор отправляет выделенные
// объекты со второй страницы пунктом «Отправить в чат» быстрого меню — гость видит карточку, «Показать» переводит его
// на ту страницу.
import { expect, test } from '@playwright/test';
import { Board } from './fixtures';
import { createInvite, device, openAt, stateOf, useNight5Server } from './night5-helpers';

const env = useNight5Server();

test.describe('чат: вложения', () => {
  test('картинка и объекты доски доходят до гостя; просмотр и «Показать»', async ({ browser }) => {
    const { base } = env.get();
    const A = await device(browser, base, { name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    const boardA = new Board(a);
    await boardA.rect(400, 300, 520, 380);
    const link = await createInvite(a);
    await expect.poll(() => stateOf(a, s => s.collabRole), { timeout: 15000 }).toBe('host');
    await a.locator('#share-dialog').press('Escape');
    const G = await device(browser, base, { name: 'Капибара' });
    const g = await openAt(G, link, env.errors, 'guest');

    // автор: скрепка → файл → чип «Изображение · 64×48» → отправка без текста
    await a.locator('#btn-notify').click();
    const aPanel = a.locator('#side-panel');
    await aPanel.locator('#np-tab-chat').click();
    const png = await a.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 48;
      const x = c.getContext('2d')!;
      x.fillStyle = '#2f6fed'; x.fillRect(0, 0, 64, 48);
      x.fillStyle = '#ffd43b'; x.fillRect(16, 12, 32, 24);
      return c.toDataURL('image/png').split(',')[1];
    });
    const chooser = a.waitForEvent('filechooser');
    await aPanel.locator('.composer-attach-image').click();
    await (await chooser).setFiles({ name: 'доска.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(aPanel.locator('.cchip .cchip-label')).toHaveText('Изображение · 64×48');
    await expect(aPanel.locator('.composer-send')).toBeEnabled();
    await aPanel.locator('.composer-send').click();
    await expect(aPanel.locator('.cchip')).toHaveCount(0);
    await expect(aPanel.locator('#np-view-chat .cf-mine .cf-att-image img')).toHaveCount(1);

    // гость: картинка в ленте, щелчок — просмотр поверх доски, Esc закрывает
    await g.locator('#btn-notify').click();
    const gPanel = g.locator('#side-panel');
    await gPanel.locator('#np-tab-chat').click();
    const thumb = gPanel.locator('#np-view-chat .cf-att-image');
    await expect(thumb).toBeVisible({ timeout: 10000 });
    await expect(thumb.locator('img')).toHaveAttribute('src', /^data:image\/(jpeg|webp|png);base64,/);
    await thumb.click();
    const lb = g.locator('.chat-lightbox');
    await expect(lb).toBeVisible();
    await expect(lb.locator('.clb-img')).toHaveAttribute('alt', 'Изображение 64×48');
    // гость-редактор может вставить на доску; здесь — только закрываем
    await expect(lb.locator('.clb-insert')).toBeVisible();
    await g.keyboard.press('Escape');
    await expect(lb).toHaveCount(0);

    // автор: вторая страница, прямоугольник, выделение → «Отправить в чат» в быстром меню
    await aPanel.locator('#np-tab-all').click();
    await a.locator('#side-panel-close').click();
    await boardA.addPage();
    await a.keyboard.press('Escape');
    const page2 = await stateOf(a, s => s.pageId as string);
    const page1 = await stateOf(a, s => s.project.pages[0].id as string);
    await boardA.rect(300, 300, 460, 400);
    await boardA.tool('v');
    await boardA.click({ x: 380, y: 300 });
    await expect.poll(() => stateOf(a, s => s.selection.size)).toBe(1);
    const toChat = a.locator('#quick-menu .qm-send-chat');
    await expect(toChat).toBeVisible();
    await toChat.click();
    await expect(aPanel).toBeVisible();
    await expect(aPanel.locator('#np-tab-chat')).toHaveAttribute('aria-selected', 'true');
    await expect(aPanel.locator('.cchip .cchip-label')).toHaveText(/^1 объект · «.+»$/);
    await aPanel.locator('.composer-send').click();
    await expect(aPanel.locator('#np-view-chat .cf-mine .cf-att-board')).toHaveCount(1);

    // гость: карточка объектов; со страницы 1 «Показать» переводит на страницу 2
    const card = gPanel.locator('#np-view-chat .cf-att-board');
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card.locator('.cf-att-label')).toHaveText(/^1 объект · «.+»$/);
    await expect(card.locator('.cf-att-preview img')).toHaveAttribute('src', /^data:image\/(png|jpeg);base64,/);
    await expect(card.locator('.cf-att-copy')).toHaveAttribute('aria-disabled', 'false');
    if (await stateOf(g, s => s.pageId) !== page1) {
      await g.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await g.keyboard.press('Control+1');
    }
    await expect.poll(() => stateOf(g, s => s.pageId), { timeout: 10000 }).toBe(page1);
    await card.locator('.cf-att-show').click();
    await expect.poll(() => stateOf(g, s => s.pageId), { timeout: 10000 }).toBe(page2);
    await expect.poll(() => stateOf(g, s => s.flashes.length)).toBeGreaterThan(0);
    await A.close();
    await G.close();
  });
});
