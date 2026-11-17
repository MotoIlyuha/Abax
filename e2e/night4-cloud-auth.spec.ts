// Ночь №4: вход в аккаунт из окна первого входа и из «Профиля» — настоящий сервер Abax в процессе теста
// с dev-провайдерами (код почты в ответе, мгновенный вход тестовыми Telegram и Google).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createAppServer, type AppServer } from '../server/app';
import { Board } from './fixtures';

let srv: AppServer;
let base = '';
let tmp = '';

test.beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'abax-e2e-auth-'));
  srv = createAppServer({
    dbPath: ':memory:', assetsDir: path.join(tmp, 'assets'), jwtSecret: 'e2e-secret', devAuth: true,
    staticDir: path.join(__dirname, '..', 'dist'),
  });
  base = (await srv.listen(0, '127.0.0.1')).url;
});
test.afterAll(async () => {
  await srv.close();
  rmSync(tmp, { recursive: true, force: true });
});

const errors: string[] = [];
test.afterEach(() => { expect(errors.splice(0), 'ошибки JS на страницах').toEqual([]); });

/** Новое устройство с облаком: окно первого входа появляется. */
async function device(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await ctx.route(/^https:\/\/(api\.)?github\.com\//, r => r.abort());
  await ctx.addInitScript(url => localStorage.setItem('doska.apiUrl', url), base);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${base}/`);
  await page.waitForFunction(() => !!(window as any).__doska);
  await expect(page.locator('#onboarding')).toBeVisible();
  return page;
}

/** Пользователь сервера по сессии этой страницы. */
const me = (page: Page) => page.evaluate(async api => {
  const r = await fetch(`${api}/api/me`, { headers: { Authorization: `Bearer ${localStorage.getItem('doska.session')}` } });
  return (await r.json()).user;
}, base);

test.describe('вход через облако (dev-провайдеры)', () => {
  test('почта на шаге 1 → шаг 2 «Вы вошли», привязка Telegram и возврат на шаг 2, имя уходит на сервер', async ({ browser }) => {
    const page = await device(browser);
    await page.locator('.ob-step1 [data-provider="email"]').click();
    await page.locator('.ob-step1 .em-input').fill('anya@abax.example');
    await page.locator('.ob-step1 .em-go').click();
    const hint = page.locator('.ob-step1 .em-otp .ob-dev-hint');
    await expect(hint).toContainText('Режим разработки: код');
    await expect(page.locator('.ob-step1 .em-hint')).toContainText('anya@abax.example');
    const code = /(\d{6})/.exec((await hint.textContent())!)![1];
    await page.locator('.ob-step1 .em-code').fill(code);
    await expect(page.locator('#onboarding')).toHaveAttribute('data-step', '2');
    await expect(page.locator('.ob-step2 .ob-title')).toContainText('Вы вошли');
    await expect(page.locator('.ob-link [data-provider]')).toHaveCount(2);
    await expect(page.locator('.ob-link')).toContainText('в любой момент в Настройках');

    // имя и курсор до перехода к провайдеру сохраняются
    await page.locator('.ob-name').fill('Аня');
    await page.locator('.ob-step2 [data-cursor="lavender"]').click();
    await page.locator('.ob-link [data-provider="telegram"]').click();
    await page.waitForURL(u => u.pathname === '/' && !u.hash);
    await expect(page.locator('#onboarding')).toHaveAttribute('data-step', '2');
    await expect(page.locator('.ob-name')).toHaveValue('Аня');
    await expect(page.locator('.ob-step2 [data-cursor="lavender"]')).toHaveClass(/active/);
    await expect(page.locator('.ob-link [data-provider]')).toHaveCount(1); // остался Google
    expect(await me(page)).toMatchObject({ email: 'anya@abax.example', telegram: true });

    await page.locator('.ob-continue').click();
    await expect(page.locator('#onboarding')).toHaveCount(0);
    await expect.poll(async () => (await me(page)).displayName).toBe('Аня');
    expect(await me(page)).toMatchObject({ cursorId: 'lavender', nameCustom: true });
    await page.context().close();
  });

  test('Google на шаге 1: мгновенный dev-вход, шаг 2 с именем аккаунта; «Профиль» — способы входа и выход', async ({ browser }) => {
    const page = await device(browser);
    await page.locator('.ob-step1 [data-provider="google"]').click();
    await page.waitForURL(u => u.pathname === '/' && !u.hash);
    await expect(page.locator('#onboarding')).toHaveAttribute('data-step', '2');
    await expect(page.locator('.ob-name')).toHaveValue('Тестовый Google');
    await page.locator('.ob-continue').click();
    await expect(page.locator('#onboarding')).toHaveCount(0);
    await new Board(page).ready();

    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-nav-item', { hasText: 'Профиль' }).click();
    await expect(page.locator('.ps-status')).toContainText('Вы вошли');
    await expect(page.locator('.ps-method[data-provider="google"]')).toContainText('привязан');
    await expect(page.locator('.ps-method[data-provider="email"] .ps-link')).toHaveText('Привязать');
    await page.locator('.ps-logout').click();
    await expect(page.locator('.ps-providers [data-provider]')).toHaveCount(3);
    expect(await me(page)).toMatchObject({ isAnonymous: true });
    // профиль устройства после выхода остаётся
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('doska.profile')!).name)).toBe('Тестовый Google');
    await page.context().close();
  });

  test('вход из «Профиля» через Telegram возвращает в «Профиль» с сообщением', async ({ browser }) => {
    const page = await device(browser);
    await page.locator('.ob-skip').click();
    await page.locator('.ob-continue').click();
    await new Board(page).ready();
    await page.keyboard.press('Control+Comma');
    await page.locator('.sd-nav-item', { hasText: 'Профиль' }).click();
    await page.locator('.ps-providers [data-provider="telegram"]').click();
    await page.waitForURL(u => u.pathname === '/' && !u.hash);
    await expect(page.locator('#sd-title')).toHaveText('Профиль');
    await expect(page.locator('.ps-account .ob-msg')).toHaveText('Вы вошли в аккаунт');
    await expect(page.locator('.ps-method[data-provider="telegram"]')).toContainText('@abax_dev');
    await page.context().close();
  });
});
