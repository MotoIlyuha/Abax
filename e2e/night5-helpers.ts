// Общее для E2E Ночи №5: настоящий сервер Abax в процессе теста (база в памяти, клиент из dist/), изолированные
// «устройства» (свои контексты браузера) и вход в аккаунт по почте через dev-код без окна входа.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createAppServer, type AppServer } from '../server/app';
import { memoryMailer, type MailMessage } from '../server/mailer';
import { skipOnboarding } from './fixtures';

export interface Night5Server {
  srv: AppServer;
  base: string;
  outbox: MailMessage[];
}

/** Сервер на весь файл спецификации; ошибки JS на страницах проверяются после каждого теста. */
export function useNight5Server(opts: { enforceLimits?: boolean } = {}): { get: () => Night5Server; errors: string[] } {
  let ctx: Night5Server | null = null;
  let tmp = '';
  const errors: string[] = [];
  test.beforeAll(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'abax-e2e-n5-'));
    const mailer = memoryMailer();
    const srv = createAppServer({
      dbPath: ':memory:', assetsDir: path.join(tmp, 'assets'), jwtSecret: 'e2e-secret', devAuth: true, mailer,
      enforceLimits: opts.enforceLimits ?? false, staticDir: path.join(__dirname, '..', 'dist'), roomSaveMs: 50,
    });
    const base = (await srv.listen(0, '127.0.0.1')).url;
    (srv.app.opts as { publicWebUrl?: string }).publicWebUrl = base;
    ctx = { srv, base, outbox: mailer.outbox };
  });
  test.afterAll(async () => {
    await ctx?.srv.close();
    rmSync(tmp, { recursive: true, force: true });
  });
  test.afterEach(() => { expect(errors.splice(0), 'ошибки JS на страницах').toEqual([]); });
  return { get: () => ctx!, errors };
}

export interface Account { token: string; id: string; email: string }

/** Вход по почте с dev-кодом прямо через API (каждый вызов — новая сессия того же аккаунта). */
export async function login(base: string, email: string): Promise<Account> {
  const post = async (url: string, body: unknown) => {
    const r = await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await r.json() as Record<string, any>;
    if (!r.ok) throw new Error(`${url}: ${r.status} ${JSON.stringify(json)}`);
    return json;
  };
  const { devCode } = await post('/api/auth/email/start', { email });
  const res = await post('/api/auth/email/verify', { email, code: devCode });
  return { token: res.token as string, id: res.user.id as string, email };
}

/** Отдельное «устройство»: свой контекст и localStorage, облако — на тестовый сервер, при желании — вход в аккаунт. */
export async function device(browser: Browser, base: string, opts: { session?: string; name?: string } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await ctx.route(/^https:\/\/(api\.)?github\.com\//, r => r.abort());
  await ctx.addInitScript(([url, session, name]) => {
    // только при первом запуске контекста: перезагрузка не должна возвращать старую сессию
    if (localStorage.getItem('doska.apiUrl') === null) {
      localStorage.setItem('doska.apiUrl', url);
      if (session) localStorage.setItem('doska.session', session);
      if (name) localStorage.setItem('doska.profile', JSON.stringify({ name, cursorId: 'default', onboarded: true, updatedAt: 1 }));
    }
  }, [base, opts.session ?? '', opts.name ?? ''] as const);
  await skipOnboarding(ctx);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  return ctx;
}

export async function openAt(ctx: BrowserContext, url: string, errors: string[], ready: 'board' | 'link' | 'guest' | 'none' = 'board'): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).__doska);
  if (ready === 'board') await expect(page.locator('#toolbar .tool').first()).toBeVisible();
  if (ready === 'link') await expect(page.locator('#link-banner')).toBeVisible();
  if (ready === 'guest') await expect(page.locator('body')).toHaveClass(/collab-guest/);
  return page;
}

export const stateOf = <T>(page: Page, fn: (s: any) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__doska.state)`) as Promise<T>;

/** Ссылка-приглашение из окна «Совместная работа» (окно остаётся открытым). */
export async function createInvite(page: Page): Promise<string> {
  await page.locator('#btn-share').click();
  const box = page.locator('#share-dialog .share-invite');
  await expect(box).toBeVisible();
  // проект должен быть в облаке: кнопка появится, когда он туда ушёл
  await expect(box.locator('button', { hasText: 'Создать ссылку-приглашение' })).toBeVisible({ timeout: 15000 });
  // окно перерисовывается раз в две секунды (и пока проект впервые уходит в облако, ссылки ещё нет): повторяем нажатие
  await expect(async () => {
    const create = box.locator('button', { hasText: 'Создать ссылку-приглашение' });
    if (await create.count() > 0) await create.click({ timeout: 1000 }).catch(() => {});
    await expect(box.locator('.share-link')).toBeVisible({ timeout: 2500 });
  }).toPass({ timeout: 20000 });
  return (await box.locator('.share-link').textContent())!;
}

/** Строки проектов пользователя на сервере. */
export function serverProjects(srv: AppServer, ownerId: string): { id: string; title: string; rev: number; data_json: string }[] {
  return srv.db.prepare('SELECT id, title, rev, data_json FROM projects WHERE owner_id = ? AND is_deleted = 0').all(ownerId) as never;
}

/** Пользователь, которому принадлежит сессия страницы. */
export async function userIdOf(page: Page): Promise<string> {
  await expect.poll(() => page.evaluate(() => localStorage.getItem('doska.session'))).toBeTruthy();
  return page.evaluate(async () => {
    const r = await fetch('/api/me', { headers: { Authorization: `Bearer ${localStorage.getItem('doska.session')}` } });
    return (await r.json()).user.id as string;
  });
}
