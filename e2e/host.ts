// Автор — страница с doskaAPI, как в Electron: хранилище проектов и файловые диалоги живут в тесте,
// за share* стоит настоящий сервер electron/share.cjs. Гости — отдельные браузеры по ссылке-приглашению.
import path from 'node:path';
import { createRequire } from 'node:module';
import { test as base, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { Board, expect } from './fixtures';

export { expect };

process.env.DOSKA_AWAY_MS = '1500'; // «Отошёл» — через 1.5 с бездействия (читается при загрузке share.cjs)
const require = createRequire(__filename);
const share = require('../electron/share.cjs');
const { createShareServer } = share;
export const MAX_EDITORS: number = share.MAX_EDITORS;
const DIST = path.join(__dirname, '..', 'dist');
const { createCloudLink, normalizeRelayUrl, cloudGuestUrl } = require('../electron/cloud-link.cjs');
const { createRelay } = require('../relay/server.cjs');
const WS = require('ws');

type ShareServer = {
  port: number; code: string; hostKey: string; room: any;
  setRights(uid: number, patch: unknown): { ok: boolean; error?: string };
  users(): any[];
  attach(sock: unknown, opts: unknown): number | null;
  refresh(sock: unknown): boolean;
  close(): void;
};

/** Автор: доска с doskaAPI, хранилище проектов в памяти теста, сервер совместной работы — настоящий. */
export class Host {
  readonly board: Board;
  readonly store = new Map<string, any>();
  server: ShareServer | null = null;
  testWindows = 0;
  /** Что «сохранил» диалог экспорта PNG. */
  readonly exports: { name: string; dataUrl: string }[] = [];
  /** Что «выберет» пользователь в следующем диалоге открытия файла (null — отмена). */
  nextImage: string | null = null;
  nextPdf: string | null = null;
  /** Что ответит appInfo (electron/main.cjs, app:info): Windows, установленная или переносная версия. */
  appInfo = { platform: 'win32', portable: false };
  /** Иконки окна, которые поставило приложение (свои цвета логотипа). */
  readonly icons: string[] = [];
  /** Облачный ретранслятор теста (relay/server.cjs) — поднимается при первом обращении. */
  relay: any = null;
  /** Подключение автора к ретранслятору (electron/cloud-link.cjs). */
  cloud: any = null;
  /** Адрес ретранслятора по умолчанию, как DOSKA_RELAY_URL в main.cjs: undefined — тестовый, '' — не задан. */
  defaultRelay: string | undefined = undefined;
  /** Сокеты автора к ретранслятору — чтобы оборвать связь, как при пропавшей сети. */
  readonly cloudSockets: any[] = [];

  constructor(readonly page: Page) {
    this.board = new Board(page);
  }

  get dialog() { return this.page.locator('#share-dialog'); }

  async relayUrl(): Promise<string> {
    this.relay ??= await createRelay({ port: 0, host: '127.0.0.1', statsIntervalMs: 0, log: () => {} });
    return `ws://127.0.0.1:${this.relay.port}`;
  }

  /** То же, что cloudInfo() в main.cjs; клиент гостя — эта же сборка на vite preview (вместо GitHub Pages). */
  private cloudInfo() {
    if (!this.cloud) return null;
    const st = this.cloud.status();
    const guestBase = new URL('/', this.page.url()).href;
    return { state: st.state, url: st.room ? cloudGuestUrl(guestBase, st.relayUrl, st.room, st.key) : null, error: st.error, guests: st.guests, relayUrl: st.relayUrl };
  }

  /** То же, что share:cloudStart в main.cjs. */
  private async cloudStart(input?: string) {
    if (!this.server) return { ok: false, error: 'Совместная работа выключена' };
    const state = this.cloud?.status().state;
    if (this.cloud && state !== 'failed' && state !== 'stopped') return { ok: true, cloud: this.cloudInfo() };
    this.cloud?.stop();
    this.cloud = null;
    const fallback = this.defaultRelay === undefined ? await this.relayUrl() : this.defaultRelay;
    let relayUrl: string;
    try { relayUrl = normalizeRelayUrl(input || fallback); } catch (e: any) {
      return { ok: false, error: input || fallback ? e.message : 'Не указан адрес ретранслятора' };
    }
    const sockets = this.cloudSockets;
    class Tracked extends WS { constructor(...a: any[]) { super(...a); sockets.push(this); } }
    const link = createCloudLink({ relayUrl, attach: this.server.attach, refresh: this.server.refresh, WebSocketImpl: Tracked, backoffMs: [200] });
    try { await link.start(); } catch (e: any) { link.stop(); return { ok: false, error: e.message }; }
    this.cloud = link;
    return { ok: true, cloud: this.cloudInfo() };
  }

  /** Оборвать связь автора с ретранслятором (подключение восстановится само). */
  dropCloudConnection(): void {
    this.cloudSockets.at(-1)?.terminate();
  }

  async open(): Promise<void> {
    await this.page.exposeFunction('__pwStorage', async (op: string, arg: any) => {
      if (op === 'list') {
        return [...this.store.values()]
          .map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, pageCount: Array.isArray(p.pages) ? p.pages.length : 1 }))
          .sort((a, b) => b.updatedAt - a.updatedAt);
      }
      if (op === 'load') return this.store.get(arg) ?? null;
      if (op === 'save') { this.store.set(arg.id, arg); return undefined; }
      if (op === 'remove') { this.store.delete(arg); return undefined; }
      throw new Error(op);
    });
    await this.page.exposeFunction('__pwFiles', async (op: string, arg: any) => {
      if (op === 'exportPng') { this.exports.push(arg); return true; }
      if (op === 'pickImage') return this.nextImage;
      if (op === 'pickPdf') return this.nextPdf;
      throw new Error(op);
    });
    await this.page.exposeFunction('__pwAppInfo', async () => this.appInfo);
    await this.page.exposeFunction('__pwSetIcon', async (png: string) => { this.icons.push(png); return true; });
    // то же, что делают обработчики share:* в electron/main.cjs
    await this.page.exposeFunction('__pwShare', async (op: string, arg: any) => {
      const info = () => ({
        port: this.server!.port, code: this.server!.code,
        url: `http://127.0.0.1:${this.server!.port}/?room=${this.server!.code}`, maxEditors: MAX_EDITORS,
        cloud: this.cloudInfo(),
      });
      if (op === 'start') {
        if (!this.server) {
          this.server = await createShareServer({ port: 0, code: 'E2E' + Math.random().toString(36).slice(2, 5).toUpperCase() });
          (this.server as any).setDistDir(DIST);
        }
        return { ok: true, ...info(), hostKey: this.server!.hostKey, users: this.server!.users() };
      }
      if (op === 'status') return this.server ? { active: true, ...info(), users: this.server.users() } : { active: false };
      if (op === 'stop') { this.cloud?.stop(); this.cloud = null; this.server?.close(); this.server = null; return { ok: true }; }
      if (op === 'cloudStart') return this.cloudStart(arg?.relayUrl);
      if (op === 'cloudStop') { this.cloud?.stop(); this.cloud = null; return { ok: true }; }
      if (op === 'setRights') return this.server ? this.server.setRights(arg.uid, arg.patch) : { ok: false };
      if (op === 'testWindow') { this.testWindows++; return { ok: true }; }
      throw new Error(op);
    });
    await this.page.addInitScript(() => {
      const w = window as any;
      const st = (op: string, arg?: unknown) => w.__pwStorage(op, arg);
      const sh = (op: string, arg?: unknown) => w.__pwShare(op, arg);
      w.doskaAPI = {
        list: () => st('list'),
        load: (id: string) => st('load', id),
        save: (p: unknown) => st('save', p),
        remove: (id: string) => st('remove', id),
        exportPng: (dataUrl: string, name: string) => w.__pwFiles('exportPng', { dataUrl, name }),
        pickPdf: () => w.__pwFiles('pickPdf'),
        pickImage: () => w.__pwFiles('pickImage'),
        shareStart: () => sh('start'),
        shareStop: () => sh('stop'),
        shareStatus: () => sh('status'),
        shareSetRights: (uid: number, patch: unknown) => sh('setRights', { uid, patch }),
        shareOpenTestWindow: () => sh('testWindow'),
        shareCloudStart: (opts?: { relayUrl?: string }) => sh('cloudStart', opts),
        shareCloudStop: () => sh('cloudStop'),
        appInfo: () => w.__pwAppInfo(),
        setAppIcon: (png: string) => w.__pwSetIcon(png),
      };
    });
    await this.board.open();
  }

  /** Открывает доступ через интернет из диалога (совместная работа уже включена) и возвращает ссылку. */
  async shareCloud(): Promise<string> {
    await this.dialog.locator('button', { hasText: 'Пригласить через интернет' }).click();
    const link = this.dialog.locator('.share-link-cloud');
    await expect(link).toHaveText(/#relay=ws%3A%2F%2F127\.0\.0\.1%3A\d+&r=[\w-]{22}&k=[\w-]{43}$/);
    return (await link.textContent())!;
  }

  /** Включает совместную работу из диалога и возвращает ссылку-приглашение. */
  async share(): Promise<string> {
    await this.page.locator('#btn-share').click();
    await this.dialog.locator('button', { hasText: 'Включить совместную работу' }).click();
    const link = this.dialog.locator('.share-link');
    await expect(link).toHaveText(/^http:\/\/127\.0\.0\.1:\d+\/\?room=/);
    return (await link.textContent())!;
  }

  userRow(name: string) {
    return this.dialog.locator('.share-user').filter({ hasText: name });
  }

  /** Право гостя на страницу через выпадающий список в диалоге. */
  async setRight(guest: string, pageIndex: number, right: 'view' | 'edit' | 'hidden'): Promise<void> {
    const sel = this.userRow(guest).locator('select').nth(pageIndex);
    await expect(sel).toBeVisible();
    await sel.selectOption(right);
  }
}

export class Guest {
  readonly board: Board;
  constructor(readonly ctx: BrowserContext, readonly page: Page, readonly name: string) {
    this.board = new Board(page);
  }
}

export const test = base.extend<{ host: Host; join: (url: string, name: string) => Promise<Guest> }>({
  host: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    const host = new Host(page);
    await host.open();
    await use(host);
    host.cloud?.stop();
    host.server?.close();
    await host.relay?.close();
    expect(errors, 'ошибки JS у автора').toEqual([]);
  },
  join: async ({ browser }, use) => {
    const guests: Guest[] = [];
    const errors: string[] = [];
    await use(async (url, name) => {
      const g = await openGuest(browser, url, name);
      g.page.on('pageerror', e => errors.push(`${name}: ${e}`));
      guests.push(g);
      return g;
    });
    for (const g of guests) await g.ctx.close();
    expect(errors, 'ошибки JS у гостей').toEqual([]);
  },
});

export async function openGuest(browser: Browser, url: string, name: string): Promise<Guest> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${url}&name=${encodeURIComponent(name)}`);
  const g = new Guest(ctx, page, name);
  await page.waitForFunction(() => !!(window as any).__doska);
  return g;
}
