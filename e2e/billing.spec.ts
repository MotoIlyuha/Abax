import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createAppServer } from '../server/app';
import { skipOnboarding } from './fixtures';

test('ЮKassa: переход к оплате и выдача тарифа после проверки', async ({ page, context }) => {
  const dir = mkdtempSync(join(tmpdir(), 'abax-e2e-billing-'));
  let payment: any;
  const srv = createAppServer({
    dbPath: ':memory:', assetsDir: join(dir, 'assets'), jwtSecret: 'e2e-billing', enforceLimits: true,
    staticDir: join(__dirname, '..', 'dist'), publicWebUrl: 'https://abax.example',
    yookassaShopId: 'test-shop', yookassaSecretKey: 'test-secret',
    fetch: async (_input, init) => {
      if (init?.method === 'POST') {
        const request = JSON.parse(init.body as string);
        payment = { id: 'provider-e2e', status: 'pending', paid: false, amount: request.amount, metadata: request.metadata,
          confirmation: { confirmation_url: 'https://yoomoney.ru/checkout/payments/e2e' } };
      }
      return Response.json(payment);
    },
  });
  try {
    const { url } = await srv.listen(0, '127.0.0.1');
    const login = await fetch(`${url}/api/auth/anon`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceToken: 'e2e-billing-device-token-12345678901234567890' }) });
    const auth = await login.json();
    srv.db.prepare("UPDATE users SET email = 'billing@example.com' WHERE id = ?").run(auth.user.id);
    await skipOnboarding(context);
    await context.addInitScript(({ base, token }) => {
      localStorage.setItem('doska.apiUrl', base);
      localStorage.setItem('doska.session', token);
    }, { base: url, token: auth.token });
    await context.route(/^https:\/\/(api\.)?github\.com\//, route => route.abort());
    await context.route('https://yoomoney.ru/**', route => route.fulfill({ contentType: 'text/plain', body: 'Тестовая оплата' }));
    await page.goto(url);
    await page.waitForFunction(() => !!(window as any).__doska);
    await page.locator('#btn-tier').click();
    await page.locator('.pl-card-pro .pl-cta').click();
    const link = page.getByRole('link', { name: 'Перейти к оплате' });
    await expect(link).toHaveAttribute('href', 'https://yoomoney.ru/checkout/payments/e2e');
    await expect(page.locator('.pl-card-free')).toHaveClass(/is-current/);
    const popupPromise = context.waitForEvent('page');
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://yoomoney.ru/checkout/payments/e2e');
    payment.status = 'succeeded';
    payment.paid = true;
    // Проверяем webhook настоящего сервера, затем кнопку возвращения в клиенте.
    const notification = await fetch(`${url}/api/billing/yookassa/webhook`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'notification', event: 'payment.succeeded', object: { id: payment.id } }) });
    expect(notification.status).toBe(200);
    await popup.close();
    await page.bringToFront();
    await page.getByRole('button', { name: 'Проверить оплату' }).click();
    await expect(page.locator('.pl-card-pro .pl-current')).toHaveText('Ваш тариф');
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
