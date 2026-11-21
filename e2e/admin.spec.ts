import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { build, preview } from 'vite';
import { signSession } from '../server/auth';
import { memoryMailer } from '../server/mailer';
import { createUser } from '../server/users';
import { closeApps, makeApp, proj, putProject } from '../tests/server/helpers';

const adminId = 'c5703697-4e79-4632-8199-0ca761c01e59';
const email = 'admin@abax.test';
const configFile = resolve('admin/vite.config.ts');

const test = base.extend<{ admin: { origin: string; mailer: ReturnType<typeof memoryMailer> } }>({
  admin: async ({}, use) => {
    const mailer = memoryMailer();
    const app = await makeApp({ adminAccounts: [[adminId, email]], mailer });
    const outDir = join(app.dir, 'dist-admin');
    let front: Awaited<ReturnType<typeof preview>> | undefined;
    try {
      await build({ configFile, logLevel: 'error', build: { outDir } });
      front = await preview({
        configFile, logLevel: 'error', build: { outDir },
        preview: { host: '127.0.0.1', port: 0, proxy: { '^/api/(admin(?:/|$)|auth/email/(start|verify)$)': { target: app.base, changeOrigin: false } } },
      });
      const origin = 'http://127.0.0.1:' + (front.httpServer.address() as AddressInfo).port;
      app.app.opts.adminOrigin = new URL(origin);
      const admin = createUser(app.db, app.clock.t, { display_name: 'Дежурный администратор' });
      app.db.prepare('UPDATE users SET id = ?, email = ? WHERE id = ?').run(adminId, email, admin.id);
      const user = createUser(app.db, app.clock.t, { display_name: 'Анна Волкова', tg_id: '98' });
      app.db.prepare("UPDATE users SET plan = 'tutor', plan_expires_at = ?, email = 'anna@abax.test' WHERE id = ?").run(app.clock.t - 1, user.id);
      const token = signSession(app.app.opts.jwtSecret, user.id, app.clock.t);
      expect((await putProject(app, token, proj('admin-e2e-board'))).status).toBe(200);
      app.db.prepare("INSERT INTO public_aliases (alias, project_id, owner_id, state, created_at, updated_at) VALUES ('old-abax', 'admin-e2e-board', ?, 'active', 1, 1)").run(user.id);
      const insert = app.db.prepare("INSERT INTO payments (id, user_id, plan, days, amount, status, provider, created_at, resolved_at) VALUES (?, ?, 'pro', 30, 399, ?, 'yookassa', ?, ?)");
      insert.run('paid-order', user.id, 'paid', app.clock.t - 1000, app.clock.t);
      insert.run('pending-order', user.id, 'pending', app.clock.t, null);
      app.db.prepare("INSERT INTO yookassa_checkouts (payment_id, provider_id, request_json) VALUES ('paid-order', 'provider-paid', '{}'), ('pending-order', 'provider-pending', '{}')").run();
      for (let i = 0; i < 26; i++) createUser(app.db, app.clock.t, { display_name: 'Пользователь ' + i });
      await use({ origin, mailer });
    } finally {
      if (front) {
        if ('closeAllConnections' in front.httpServer) front.httpServer.closeAllConnections();
        await new Promise<void>(done => front!.httpServer.close(() => done()));
      }
      await closeApps();
    }
  },
});

async function login(page: Page, admin: { origin: string; mailer: ReturnType<typeof memoryMailer> }) {
  await page.goto(admin.origin);
  await page.getByLabel('Почта', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Получить код' }).press('Enter');
  await expect(page.getByLabel('Код из письма')).toBeFocused();
  const code = admin.mailer.outbox.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
  expect(code).toBeTruthy();
  await page.getByLabel('Код из письма').fill(code!);
  await page.getByRole('button', { name: 'Войти', exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible();
}

test('вход, поиск и страницы пользователей, назначение тарифа с клавиатуры и журнал', async ({ page, admin }) => {
  await login(page, admin);
  const nav = page.getByRole('navigation', { name: 'Разделы панели' });
  await nav.getByRole('link', { name: 'Пользователи' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Пользователи' })).toBeFocused();
  await page.getByRole('link', { name: 'Далее', exact: true }).press('Enter');
  await expect(page.getByText('Страница 2')).toBeVisible();
  const search = page.getByLabel('Имя, почта, Telegram или ID');
  await search.fill('неизвестный');
  await search.press('Enter');
  await expect(page.getByText('По заданным условиям ничего не найдено.')).toBeVisible();
  await search.fill('ВОЛКОВА');
  await search.press('Enter');
  await page.getByRole('link', { name: 'Анна Волкова' }).press('Enter');
  await expect(page.getByText(/Истёк /)).toBeVisible();
  await expect(page.getByText('Ранее назначенный тариф: Tutor.')).toBeVisible();
  await page.getByRole('button', { name: 'Назначить тариф' }).press('Enter');
  const confirm = page.getByRole('dialog', { name: 'Назначить тариф' });
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('button', { name: 'Назначить тариф' })).toBeFocused();
  await page.getByRole('button', { name: 'Назначить тариф' }).press('Enter');
  await confirm.getByRole('combobox', { name: 'Тариф', exact: true }).selectOption('pro');
  await confirm.getByRole('combobox', { name: 'Срок', exact: true }).selectOption('permanent');
  await confirm.getByRole('button', { name: 'Назначить', exact: true }).press('Enter');
  await expect(confirm.getByLabel('Причина')).toBeFocused();
  await confirm.getByLabel('Причина').fill('Согласовано с поддержкой');
  await confirm.getByRole('button', { name: 'Назначить', exact: true }).press('Enter');
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('main').getByText('Бессрочно', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'К пользователям' }).press('Enter');
  await expect(page.getByLabel('Имя, почта, Telegram или ID')).toHaveValue('ВОЛКОВА');
  await nav.getByRole('link', { name: 'Журнал действий' }).press('Enter');
  await page.getByLabel('Операция').selectOption('plan.set');
  await page.getByRole('button', { name: 'Найти' }).press('Enter');
  await expect(page.getByRole('row', { name: /Согласовано с поддержкой/ })).toContainText('Дежурный администратор');
  await page.getByRole('button', { name: 'Выйти' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Вход в панель' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Вход в панель' })).toBeVisible();
});

test('промокоды, статусы платежей, модерация адреса и повтор после ошибки', async ({ page, admin }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, admin);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const nav = page.getByRole('navigation', { name: 'Разделы панели' });
  await nav.getByRole('link', { name: 'Промокоды' }).click();
  await expect(page.getByText('Записей пока нет.')).toBeVisible();
  await page.getByRole('button', { name: 'Создать промокод' }).click();
  const create = page.getByRole('dialog', { name: 'Создать промокод' });
  await create.getByLabel('Код', { exact: true }).fill('november-abax');
  await create.getByLabel('Дней тарифа').fill('7');
  await create.getByLabel('Лимит активаций').fill('3');
  await create.getByLabel('Дней действия кода').fill('2');
  await create.getByLabel('Причина').fill('Промокод для проверки');
  await create.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('row', { name: /NOVEMBER-ABAX/ })).toContainText('0 / 3');
  await page.getByRole('button', { name: 'Отключить промокод NOVEMBER-ABAX' }).click();
  const disable = page.getByRole('dialog', { name: 'Отключить промокод' });
  await disable.getByLabel('Причина').fill('Кампания завершена');
  await disable.getByRole('button', { name: 'Отключить', exact: true }).click();
  await expect(page.getByRole('row', { name: /NOVEMBER-ABAX/ })).toContainText('Отключён');
  await page.route('**/api/admin/payments?*', route => route.fulfill({ status: 500, json: { error: 'internal' } }), { times: 1 });
  await nav.getByRole('link', { name: 'Платежи' }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось выполнить запрос');
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByRole('row', { name: /provider-pending/ })).toContainText('Ожидает подтверждения');
  await expect(page.getByRole('row', { name: /provider-paid/ })).toContainText('Оплата подтверждена');
  const search = page.getByLabel('Пользователь или ID платежа');
  await search.fill('provider-paid');
  await search.press('Enter');
  await expect(page.getByRole('row', { name: /provider-pending/ })).toHaveCount(0);
  await expect(page.getByRole('row', { name: /provider-paid/ })).toBeVisible();
  await nav.getByRole('link', { name: 'Публичные адреса' }).click();
  const row = page.getByRole('row', { name: /old-abax/ });
  await expect(row).toContainText('admin-e2e-board');
  await row.getByRole('button', { name: 'Заблокировать адрес old-abax' }).click();
  const block = page.getByRole('dialog', { name: 'Заблокировать адрес' });
  await block.getByLabel('Причина').fill('Жалоба на адрес');
  await block.getByRole('button', { name: 'Заблокировать', exact: true }).click();
  await expect(row).toContainText('Заблокирован');
  await row.getByRole('button', { name: 'Разблокировать адрес old-abax' }).click();
  const unblock = page.getByRole('dialog', { name: 'Разблокировать адрес' });
  await unblock.getByLabel('Причина').fill('Жалоба снята');
  await unblock.getByRole('button', { name: 'Разблокировать', exact: true }).click();
  await expect(row).toContainText('Активный');
  await nav.getByRole('link', { name: 'Журнал действий' }).click();
  await page.getByLabel('Операция').selectOption('alias.unblock');
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page.getByRole('row', { name: /Жалоба снята/ })).toBeVisible();
});
