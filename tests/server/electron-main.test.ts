import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('node:module');

// main.cjs регистрирует ipcMain.handle(...) при загрузке — подменяем electron заглушкой
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const electronStub = {
  app: { isPackaged: true, whenReady: () => new Promise(() => {}), on: () => {} },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
};

const invoke = (ch: string, ...args: unknown[]) => handlers.get(ch)!({}, ...args) as Promise<any>;

beforeAll(() => {
  process.env.DOSKA_SHARE_PORT = '0';
  const origLoad = Module._load;
  Module._load = function (request: string, ...rest: unknown[]) {
    if (request === 'electron') return electronStub;
    return origLoad.call(this, request, ...rest);
  };
  try {
    require('../../electron/main.cjs');
  } finally {
    Module._load = origLoad;
  }
});

afterAll(async () => {
  await invoke('share:stop');
});

describe('electron main: share:* IPC', () => {
  it('share:start возвращает hostKey, которого нет в гостевой ссылке', async () => {
    const r = await invoke('share:start');
    expect(r.ok).toBe(true);
    expect(typeof r.hostKey).toBe('string');
    expect(r.hostKey.length).toBeGreaterThanOrEqual(24);
    expect(r.url).toContain(`?room=${r.code}`);
    expect(r.url).not.toContain(r.hostKey);
  });

  it('повторный share:start отдаёт тот же hostKey', async () => {
    const a = await invoke('share:start');
    const b = await invoke('share:start');
    expect(b.hostKey).toBe(a.hostKey);
    expect(b.port).toBe(a.port);
  });

  it('share:status не раскрывает hostKey', async () => {
    await invoke('share:start');
    const s = await invoke('share:status');
    expect(s.active).toBe(true);
    expect(s.hostKey).toBeUndefined();
  });

  it('hostKey из share:start пускает как автора, без него — нет', async () => {
    const r = await invoke('share:start');
    const open = (q: string) => new Promise<{ init?: any; close?: number }>(resolve => {
      const ws = new WebSocket(`ws://127.0.0.1:${r.port}/ws?${q}`);
      ws.addEventListener('message', ev => { const m = JSON.parse(String(ev.data)); if (m.t === 'init') { ws.close(); resolve({ init: m }); } });
      ws.addEventListener('close', ev => resolve({ close: ev.code }));
    });
    expect((await open(`code=${r.code}&host=1`)).close).toBe(4401);
    expect((await open(`code=${r.code}&host=1&key=${encodeURIComponent(r.hostKey)}`)).init.userId).toBe(0);
  });

  it('share:stop выключает сервер, новый старт даёт новый hostKey', async () => {
    const a = await invoke('share:start');
    await invoke('share:stop');
    expect((await invoke('share:status')).active).toBe(false);
    const b = await invoke('share:start');
    expect(b.hostKey).not.toBe(a.hostKey);
  });
});
