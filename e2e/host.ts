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

type ShareServer = {
  port: number; code: string; hostKey: string; room: any;
  setRights(uid: number, patch: unknown): { ok: boolean; error?: string };
  users(): any[];
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

  constructor(readonly page: Page) {
    this.board = new Board(page);
  }

  get dialog() { return this.page.locator('#share-dialog'); }

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
    // то же, что делают обработчики share:* в electron/main.cjs
    await this.page.exposeFunction('__pwShare', async (op: string, arg: any) => {
      const info = () => ({
        port: this.server!.port, code: this.server!.code,
        url: `http://127.0.0.1:${this.server!.port}/?room=${this.server!.code}`, maxEditors: MAX_EDITORS,
      });
      if (op === 'start') {
        if (!this.server) {
          this.server = await createShareServer({ port: 0, code: 'E2E' + Math.random().toString(36).slice(2, 5).toUpperCase() });
          (this.server as any).setDistDir(DIST);
        }
        return { ok: true, ...info(), hostKey: this.server!.hostKey, users: this.server!.users() };
      }
      if (op === 'status') return this.server ? { active: true, ...info(), users: this.server.users() } : { active: false };
      if (op === 'stop') { this.server?.close(); this.server = null; return { ok: true }; }
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
      };
    });
    await this.board.open();
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
    host.server?.close();
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
