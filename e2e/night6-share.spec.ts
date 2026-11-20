// Окно «Поделиться» (SPEC_NIGHT6 §6, редизайн): клавиатура и фокус, вкладки в шапке,
// приглашение по почте с ролью, список «Есть доступ», черновик адреса переживает вход гостя,
// путь без облака виден и работает без сервера.
import { expect, test } from '@playwright/test';
import { Board, pickOption, test as boardTest } from './fixtures';
import { createInvite, device, login, openAt, useNight5Server } from './night5-helpers';

const env = useNight5Server();

test.describe('окно «Поделиться»', () => {
  test('клавиатура: вкладки в шапке стрелками, Tab остаётся в окне, Esc закрывает и возвращает фокус', async ({ browser }) => {
    const { base } = env.get();
    const A = await device(browser, base, { name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await a.locator('#btn-share').focus();
    await a.keyboard.press('Enter');
    const dlg = a.locator('#share-dialog');
    await expect(dlg).toHaveAttribute('role', 'dialog');
    await expect(dlg).toHaveAttribute('aria-modal', 'true');
    await expect(a.locator('#share-dialog-title')).toHaveText('Поделиться: «Проект 1»');
    expect(await a.evaluate(() => !!document.activeElement?.closest('#share-dialog'))).toBe(true);
    await a.locator('#share-tab-share').focus();
    await a.keyboard.press('ArrowRight');
    await expect(a.locator('#share-tab-settings')).toHaveAttribute('aria-selected', 'true');
    await expect(a.locator('#share-tab-settings')).toBeFocused();
    await expect(a.locator('#share-panel-settings')).not.toHaveAttribute('inert', '');
    await expect(a.locator('#share-panel-share')).toHaveAttribute('inert', '');
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

  test('«Настройки доступа»: подсказки и подсветка строк — морфящиеся, сбоку от окна', async ({ browser }) => {
    const { base } = env.get();
    const A = await device(browser, base, { name: 'Лемур' });
    const a = await openAt(A, `${base}/`, env.errors);
    await a.locator('#btn-share').click();
    await a.locator('#share-tab-settings').click();
    const dlg = a.locator('#share-dialog');
    const row = dlg.locator('#share-panel-settings .share-toggle').first();
    await expect(row).toBeVisible();
    await row.hover();
    await expect(a.locator('#morph-tip[data-state="shown"] .mt-lab.cur')).toContainText('не могут сдвигать');
    expect(await a.locator('#morph-tip .mt-tip').getAttribute('data-side')).toBe('left');
    // пузырь оседает пружиной: правый край — левее окна, когда движение закончилось
    await expect.poll(async () => {
      const tip = (await a.locator('#morph-tip .mt-tip').boundingBox())!;
      const box = (await dlg.boundingBox())!;
      return tip.x + tip.width <= box.x;
    }).toBe(true);
    await expect(dlg.locator('.mt-hl')).toHaveCount(1);
    // следующая строка: тот же пузырь перетекает, подсветка одна
    await dlg.locator('#share-panel-settings .share-toggle').nth(1).hover();
    await expect(a.locator('#morph-tip .mt-lab.cur')).toContainText('Читатели и комментаторы');
    await expect(dlg.locator('.mt-hl')).toHaveCount(1);
    // закрытие окна убирает подсказку
    await a.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(a.locator('#morph-tip')).toHaveAttribute('data-state', 'hidden');
    await A.close();
  });

  test('почта с ролью и список «Есть доступ»; черновик адреса переживает вход гостя', async ({ browser }) => {
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

    // гость входит, пока автор печатает адрес; списка «Сейчас на доске» в окне нет — он в отдельном виджете
    const G = await device(browser, base, { name: 'Капибара' });
    await openAt(G, link, env.errors, 'guest');
    await expect.poll(() => a.evaluate(() => (window as any).__doska.state.collabRole), { timeout: 15000 }).toBe('host');
    await a.waitForTimeout(2500); // фоновое обновление окна (раз в 2 с) уже прошло
    await expect(a.locator('#share-dialog .share-present')).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('anna-');

    await input.pressSequentially('student@abax.example');
    await pickOption(a, box.locator('.share-email-role'), 'commenter');
    await input.press('Enter');
    const item = box.locator('.share-email-item');
    await expect(item).toHaveCount(1, { timeout: 10000 });
    await expect(item.locator('.share-email-addr')).toHaveText('anna-student@abax.example');
    await expect(item.locator('.share-email-meta')).toHaveText('отправлено, ещё не заходил');
    await expect(item.locator('.share-email-row-role')).toHaveAttribute('data-value', 'commenter');
    expect(outbox.some(m => m.to === 'anna-student@abax.example')).toBe(true);
    const access = box.locator('.share-access');
    await expect(access.locator('.share-person')).toHaveCount(2); // владелец и приглашение
    await expect(box.locator('.share-switch')).toHaveAttribute('aria-checked', 'true');
    // «Отозвать приглашение» — красный пункт в списке роли строки
    const rowRole = item.locator('.share-email-row-role');
    await expect(rowRole).toHaveAttribute('aria-label', 'Роль anna-student@abax.example');
    await rowRole.click();
    await expect(a.locator('#share-dialog [role="option"].danger')).toHaveText('Отозвать приглашение');
    await a.keyboard.press('Escape');
    await expect(a.locator('#share-dialog [role="listbox"]')).toHaveCount(0);
    await expect(a.locator('#share-dialog')).toBeVisible(); // Esc закрыл только список
    await A.close();
    await G.close();
  });
});

boardTest.describe('окно «Поделиться» без облака', () => {
  boardTest('путь без сервера — на главной: «Включить совместную работу», ссылка во вкладке через интернет', async ({ board }) => {
    const page = board.page;
    await page.locator('#btn-share').click();
    const dlg = page.locator('#share-dialog');
    await expect(dlg.locator('.share-invite')).toBeHidden();
    await expect(dlg.locator('#share-panel-share .share-p2p')).toBeVisible();
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
