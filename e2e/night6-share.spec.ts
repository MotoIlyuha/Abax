// Ночь №6, окно «Поделиться» (SPEC_NIGHT6 §6): клавиатура и фокус, приглашение по почте с ролью, три раздельных
// списка, черновик адреса переживает вход гостя, путь без облака виден и работает без сервера.
import { expect, test } from '@playwright/test';
import { Board, test as boardTest } from './fixtures';
import { createInvite, device, login, openAt, useNight5Server } from './night5-helpers';

const env = useNight5Server();

test.describe('окно «Поделиться»', () => {
  test('клавиатура: вкладки стрелками, Tab остаётся в окне, Esc закрывает и возвращает фокус', async ({ browser }) => {
    const { base } = env.get();
    const A = await device(browser, base, { name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await a.locator('#btn-share').focus();
    await a.keyboard.press('Enter');
    const dlg = a.locator('#share-dialog');
    await expect(dlg).toHaveAttribute('role', 'dialog');
    await expect(dlg).toHaveAttribute('aria-modal', 'true');
    await expect(a.locator('#share-dialog-title')).toHaveText('Поделиться: «Проект 1»');
    await expect(a.locator('#share-tab-share')).toBeFocused();
    await a.keyboard.press('ArrowRight');
    await expect(a.locator('#share-tab-settings')).toHaveAttribute('aria-selected', 'true');
    await expect(a.locator('#share-tab-settings')).toBeFocused();
    await expect(a.locator('#share-panel-settings')).toBeVisible();
    await expect(a.locator('#share-panel-share')).toBeHidden();
    // Tab по кругу не уходит из окна
    for (let i = 0; i < 40; i++) {
      await a.keyboard.press('Tab');
      expect(await a.evaluate(() => !!document.activeElement?.closest('#share-dialog'))).toBe(true);
    }
    await a.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(a.locator('#btn-share')).toBeFocused();
    await A.close();
  });

  test('почта с ролью, «Сейчас на доске» и «У кого есть доступ» раздельно; черновик адреса переживает вход гостя', async ({ browser }) => {
    const { base, outbox } = env.get();
    const host = await login(base, 'teacher-share@abax.example');
    const A = await device(browser, base, { session: host.token, name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await new Board(a).rect(400, 300, 520, 380);
    const link = await createInvite(a);
    expect(link).toMatch(/\/j\/[A-Za-z0-9_-]{24}$/); // чистая ссылка: клиента раздаёт этот сервер

    const box = a.locator('#share-dialog .share-invite');
    const input = box.locator('.share-email-input');
    await input.fill('anna-');
    await input.focus();

    // гость входит, пока автор печатает адрес
    const G = await device(browser, base, { name: 'Капибара' });
    await openAt(G, link, env.errors, 'guest');
    const present = box.locator('.share-present');
    await expect(present.locator('.share-cloud-title')).toHaveText('Сейчас на доске · 2', { timeout: 15000 });
    await expect(present.locator('.share-person', { hasText: 'Капибара' })).toContainText('по общей ссылке');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('anna-');

    await input.pressSequentially('student@abax.example');
    await box.locator('.share-email-role').selectOption('commenter');
    await input.press('Enter');
    const item = box.locator('.share-email-item');
    await expect(item).toHaveCount(1, { timeout: 10000 });
    await expect(item.locator('.share-email-addr')).toHaveText('anna-student@abax.example');
    await expect(item.locator('.share-email-meta')).toHaveText('Комментатор · отправлено, ещё не заходил');
    expect(outbox.some(m => m.to === 'anna-student@abax.example')).toBe(true);
    // три разных факта: человек с приглашением ещё не на доске; на доске — гость по ссылке
    await expect(present.locator('.share-person', { hasText: 'anna-student' })).toHaveCount(0);
    const access = box.locator('.share-access');
    await expect(access.locator('.share-person')).toHaveCount(3); // владелец, общая ссылка, приглашение
    await expect(access.locator('.share-link-row')).toContainText('ссылка включена');
    await expect(item.locator('.share-email-revoke')).toHaveAttribute('aria-label', 'Отозвать приглашение anna-student@abax.example');
    await A.close();
    await G.close();
  });
});

boardTest.describe('окно «Поделиться» без облака', () => {
  boardTest('путь без сервера — первым: «Включить совместную работу», ссылка во вкладке через интернет', async ({ board }) => {
    const page = board.page;
    await page.locator('#btn-share').click();
    const dlg = page.locator('#share-dialog');
    await expect(dlg.locator('.share-invite')).toBeHidden();
    await expect(dlg.locator('#share-panel-share > .share-p2p')).toBeVisible();
    await expect(dlg.locator('.share-other')).toHaveCount(0);
    await expect(dlg.locator('button', { hasText: 'Включить совместную работу' })).toBeVisible();
    await dlg.locator('button', { hasText: 'Включить совместную работу' }).click();
    await expect(dlg.locator('button', { hasText: 'Выключить совместную работу' })).toBeVisible();
    // во вкладке браузера гостей зовут через интернет — эта кнопка не прячется
    await expect(dlg.locator('button', { hasText: 'Пригласить через интернет' })).toBeVisible();
    await dlg.locator('button', { hasText: 'Выключить совместную работу' }).click();
    await expect(dlg.locator('button', { hasText: 'Включить совместную работу' })).toBeVisible();
  });
});
