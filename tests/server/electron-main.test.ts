// main-процесс Electron с подменённым модулем electron: проверяем IPC-обработчики
// на настоящей файловой системе (временный userData) и настоящем сервере совместной работы.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const MAIN = require.resolve('../../electron/main.cjs');
const PRELOAD = require.resolve('../../electron/preload.cjs');

type Handler = (e: unknown, ...args: unknown[]) => Promise<any>;

class FakeWindow {
  static all: FakeWindow[] = [];
  url = '';
  file = '';
  listeners = new Map<string, (...a: unknown[]) => void>();
  openHandler: ((d: { url?: string; frameName: string }) => Record<string, any>) | null = null;
  webContents = {
    on: (ev: string, fn: (...a: unknown[]) => void) => { this.listeners.set(ev, fn); },
    setWindowOpenHandler: (fn: (d: { url?: string; frameName: string }) => Record<string, any>) => { this.openHandler = fn; },
  };
  constructor(public opts: Record<string, unknown>) { FakeWindow.all.push(this); }
  async loadURL(u: string) { this.url = u; }
  async loadFile(f: string) { this.file = f; if (f.includes('missing')) throw new Error('нет файла'); }
}

const handlers = new Map<string, Handler>();
const appEvents = new Map<string, () => void>();
const dialog = {
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showErrorBox: vi.fn(),
};
let userData: string;
const appData = path.join(os.tmpdir(), 'appdata-fake');
let isPackaged = false;
let ready: Promise<void>;
const fakeElectron = {
  app: {
    get isPackaged() { return isPackaged; },
    getPath: (name: string) => (name === 'appData' ? appData : userData),
    setPath: vi.fn(),
    whenReady: () => ready,
    on: (ev: string, fn: () => void) => { appEvents.set(ev, fn); },
    quit: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
  },
  BrowserWindow: FakeWindow,
  ipcMain: { handle: (ch: string, fn: Handler) => { handlers.set(ch, fn); } },
  dialog,
  shell: { openExternal: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(async (...a: unknown[]) => a) },
};

// подменяем electron в кэше CommonJS до загрузки main.cjs
const electronPath = require.resolve('electron');
const fakeModule = new Module(electronPath);
fakeModule.filename = electronPath;
fakeModule.loaded = true;
fakeModule.exports = fakeElectron;
require.cache[electronPath] = fakeModule;

async function freePort(): Promise<number> {
  return new Promise(resolve => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function loadMain(opts: { packaged?: boolean } = {}): Promise<void> {
  isPackaged = !!opts.packaged;
  ready = Promise.resolve();
  delete require.cache[MAIN];
  handlers.clear();
  FakeWindow.all = [];
  require(MAIN);
  await ready;
  await new Promise(r => setTimeout(r, 0));
}
const invoke = (ch: string, ...args: unknown[]) => handlers.get(ch)!({}, ...args);

beforeEach(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'doska-ud-'));
  dialog.showOpenDialog.mockReset();
  dialog.showSaveDialog.mockReset();
  dialog.showErrorBox.mockReset();
  process.env.DOSKA_SHARE_PORT = String(await freePort());
});
afterAll(async () => {
  await handlers.get('share:stop')?.({});
});

describe('окно', () => {
  it('в разработке грузит dev-сервер Vite с изолированным preload', async () => {
    await loadMain();
    const w = FakeWindow.all[0];
    expect(w.url).toBe('http://localhost:5173');
    const prefs = w.opts.webPreferences as Record<string, unknown>;
    expect(prefs).toMatchObject({ contextIsolation: true, nodeIntegration: false });
    expect(prefs.preload).toBe(PRELOAD);
  });

  it('в сборке грузит dist/index.html', async () => {
    await loadMain({ packaged: true });
    expect(FakeWindow.all[0].file).toBe(path.join(path.dirname(MAIN), '..', 'dist', 'index.html'));
  });

  it('после переименования в Abax данные остаются в прежней папке профиля Doska', async () => {
    fakeElectron.app.setPath.mockClear();
    await loadMain({ packaged: true });
    expect(fakeElectron.app.setPath).toHaveBeenCalledWith('userData', path.join(appData, 'Doska'));
  });

  it('ошибки рендерера пишутся в консоль main-процесса', async () => {
    await loadMain();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = FakeWindow.all[0];
    w.listeners.get('did-fail-load')!({}, -6, 'ERR', 'http://x');
    w.listeners.get('render-process-gone')!({}, { reason: 'crashed' });
    w.listeners.get('console-message')!({}, 1, 'info', 1, 'a.js'); // info — не логируем
    w.listeners.get('console-message')!({}, 2, 'boom', 7, 'a.js');
    expect(err.mock.calls.map(c => c.join(' '))).toEqual([
      '[doska] did-fail-load: -6 ERR http://x',
      '[doska] renderer gone: crashed',
      '[doska:renderer] boom (a.js:7)',
    ]);
    err.mockRestore();
  });

  it('окно демонстрации: без меню и троттлинга, перекрытое окно продолжает рисоваться', async () => {
    await loadMain();
    expect(fakeElectron.app.commandLine.appendSwitch).toHaveBeenCalledWith('disable-features', 'CalculateNativeWinOcclusion');
    const w = FakeWindow.all[0];
    const r = w.openHandler!({ frameName: 'doska-present' });
    expect(r).toMatchObject({ action: 'allow', overrideBrowserWindowOptions: { webPreferences: { backgroundThrottling: false } } });
    const child = { removeMenu: vi.fn() };
    w.listeners.get('did-create-window')!(child, { frameName: 'doska-present' });
    expect(child.removeMenu).toHaveBeenCalled();
    // прочие окна — как раньше
    expect(w.openHandler!({ frameName: '' })).toEqual({ action: 'allow' });
    const other = { removeMenu: vi.fn() };
    w.listeners.get('did-create-window')!(other, { frameName: '' });
    expect(other.removeMenu).not.toHaveBeenCalled();
  });

  it('внешние ссылки открываются в браузере системы', async () => {
    await loadMain();
    const w = FakeWindow.all[0];
    fakeElectron.shell.openExternal.mockClear();
    expect(w.openHandler!({ url: 'https://github.com/MotoIlyuha/Doska', frameName: '' })).toEqual({ action: 'deny' });
    expect(fakeElectron.shell.openExternal).toHaveBeenCalledWith('https://github.com/MotoIlyuha/Doska');
    // окно демонстрации и about:blank — по-прежнему окна приложения
    expect(w.openHandler!({ url: 'about:blank', frameName: '' })).toEqual({ action: 'allow' });
    expect(w.openHandler!({ url: 'about:blank', frameName: 'doska-present' })).toMatchObject({ action: 'allow' });
    expect(fakeElectron.shell.openExternal).toHaveBeenCalledTimes(1);
  });

  it('закрытие всех окон завершает приложение', async () => {
    await loadMain();
    appEvents.get('window-all-closed')!();
    expect(fakeElectron.app.quit).toHaveBeenCalled();
  });
});

describe('хранение проектов', () => {
  beforeEach(() => loadMain());

  const project = (id: string, updatedAt: number, pages = 1) => ({
    id, name: `P-${id}`, createdAt: 1, updatedAt,
    pages: Array.from({ length: pages }, (_, i) => ({ id: `${id}${i}`, name: 'x', grid: 'square', elements: [] })),
  });

  it('save → list → load → delete', async () => {
    await invoke('boards:save', project('a', 1));
    await invoke('boards:save', project('b', 5, 2));
    expect(await invoke('boards:list')).toEqual([
      { id: 'b', name: 'P-b', createdAt: 1, updatedAt: 5, pageCount: 2 },
      { id: 'a', name: 'P-a', createdAt: 1, updatedAt: 1, pageCount: 1 },
    ]);
    expect((await invoke('boards:load', 'b')).pages).toHaveLength(2);
    await invoke('boards:delete', 'b');
    expect((await invoke('boards:list')).map((m: { id: string }) => m.id)).toEqual(['a']);
    expect(await invoke('boards:load', 'b')).toBeNull();
    await invoke('boards:delete', 'нет'); // несуществующий — без ошибки
  });

  it('закреплённый в избранном проект отмечен в списке', async () => {
    await invoke('boards:save', { ...project('a', 1), pinned: true });
    await invoke('boards:save', project('b', 5));
    expect(await invoke('boards:list')).toEqual([
      { id: 'b', name: 'P-b', createdAt: 1, updatedAt: 5, pageCount: 1 },
      { id: 'a', name: 'P-a', createdAt: 1, updatedAt: 1, pageCount: 1, pinned: true },
    ]);
  });

  it('запись атомарна: временный файл не остаётся', async () => {
    await invoke('boards:save', project('a', 1));
    const files = fs.readdirSync(path.join(userData, 'boards'));
    expect(files).toEqual(['a.json']);
  });

  it('id очищается от опасных символов', async () => {
    await invoke('boards:save', { ...project('x', 1), id: '../../evil' });
    expect(fs.readdirSync(path.join(userData, 'boards'))).toEqual(['evil.json']);
    expect(fs.existsSync(path.join(userData, '..', 'evil.json'))).toBe(false);
  });

  it('битые и посторонние файлы пропускаются, старые доски без страниц считаются одной', async () => {
    const dir = path.join(userData, 'boards');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'broken.json'), '{oops');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi');
    fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({ id: 'old', name: 'Старая', createdAt: 1, updatedAt: 2, elements: [] }));
    expect(await invoke('boards:list')).toEqual([{ id: 'old', name: 'Старая', createdAt: 1, updatedAt: 2, pageCount: 1 }]);
    expect(await invoke('boards:load', 'broken')).toBeNull();
  });
});

describe('диалоги файлов', () => {
  beforeEach(() => loadMain());

  it('pdf:pick — отмена и выбор', async () => {
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await invoke('pdf:pick')).toBeNull();
    const f = path.join(userData, 'hw.pdf');
    fs.writeFileSync(f, '%PDF-1.4');
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [f] });
    expect(await invoke('pdf:pick')).toBe('data:application/pdf;base64,' + Buffer.from('%PDF-1.4').toString('base64'));
    expect(dialog.showOpenDialog.mock.calls[1][0].filters[0].extensions).toEqual(['pdf']);
  });

  it('image:pick — mime по расширению (jpg → jpeg)', async () => {
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
    expect(await invoke('image:pick')).toBeNull();
    for (const [ext, mime] of [['JPG', 'jpeg'], ['png', 'png'], ['webp', 'webp']]) {
      const f = path.join(userData, `pic.${ext}`);
      fs.writeFileSync(f, 'img');
      dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [f] });
      expect(await invoke('image:pick')).toBe(`data:image/${mime};base64,` + Buffer.from('img').toString('base64'));
    }
  });

  it('export:png — отмена и запись файла', async () => {
    const dataUrl = 'data:image/png;base64,' + Buffer.from('PNGDATA').toString('base64');
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await invoke('export:png', { dataUrl, name: 'a.png' })).toBe(false);
    const out = path.join(userData, 'out.png');
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: out });
    expect(await invoke('export:png', { dataUrl, name: 'Доска.png' })).toBe(true);
    expect(fs.readFileSync(out, 'utf8')).toBe('PNGDATA');
    expect(dialog.showSaveDialog.mock.calls[1][0].defaultPath).toBe('Доска.png');
  });
});

describe('совместная работа', () => {
  beforeEach(async () => {
    await handlers.get('share:stop')?.({});
    await loadMain();
  });

  it('выключено: статус и права', async () => {
    expect(await invoke('share:status')).toEqual({ active: false });
    expect(await invoke('share:setRights', { uid: 1, patch: { all: 'edit' } })).toEqual({ ok: false, error: 'Совместная работа выключена' });
    expect(await invoke('share:openTestWindow')).toEqual({ ok: false });
  });

  it('запуск, повторный запуск, тестовое окно гостя и остановка', async () => {
    const r = await invoke('share:start');
    expect(r).toMatchObject({ ok: true, port: Number(process.env.DOSKA_SHARE_PORT), maxEditors: 4, users: [] });
    expect(r.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(r.hostKey).toEqual(expect.any(String));
    expect(r.url).toBe(`http://${r.url.split('//')[1].split(':')[0]}:${r.port}/?room=${r.code}`);
    expect(await invoke('share:start')).toMatchObject({ ok: true, code: r.code }); // тот же сервер
    expect(await invoke('share:status')).toMatchObject({ active: true, code: r.code });

    expect(await invoke('share:openTestWindow')).toEqual({ ok: true });
    expect(FakeWindow.all.at(-1)!.url).toBe(`http://127.0.0.1:${r.port}/?room=${r.code}&name=${encodeURIComponent('Тест-гость')}`);

    // гость подключается — автор может выдать ему права
    const ws = new WebSocket(`ws://127.0.0.1:${r.port}/ws?code=${r.code}`);
    await new Promise(res => { ws.onmessage = res; });
    expect(await invoke('share:setRights', { uid: 1, patch: { all: 'edit' } })).toEqual({ ok: true });
    expect((await invoke('share:status')).users[0].rights.default).toBe('edit');
    ws.close();

    expect(await invoke('share:stop')).toEqual({ ok: true });
    expect(await invoke('share:status')).toEqual({ active: false });
  });

  it('занятый порт — берётся следующий свободный', async () => {
    const busy = Number(process.env.DOSKA_SHARE_PORT);
    const blocker = net.createServer().listen(busy);
    await new Promise(r => blocker.once('listening', r));
    try {
      const r = await invoke('share:start');
      expect(r.ok).toBe(true);
      expect(r.port).toBeGreaterThan(busy);
    } finally {
      await invoke('share:stop');
      blocker.close();
    }
  });
});

describe('preload', () => {
  it('пробрасывает API в окно через contextBridge', () => {
    delete require.cache[PRELOAD];
    require(PRELOAD);
    const [name, api] = fakeElectron.contextBridge.exposeInMainWorld.mock.calls[0];
    expect(name).toBe('doskaAPI');
    expect(Object.keys(api).sort()).toEqual([
      'exportPng', 'list', 'load', 'pickImage', 'pickPdf', 'remove', 'save',
      'shareOpenTestWindow', 'shareSetRights', 'shareStart', 'shareStatus', 'shareStop',
    ]);
    api.save({ id: 'x' });
    api.exportPng('data:', 'a.png');
    api.shareSetRights(3, { all: 'edit' });
    expect(fakeElectron.ipcRenderer.invoke.mock.calls).toEqual([
      ['boards:save', { id: 'x' }],
      ['export:png', { dataUrl: 'data:', name: 'a.png' }],
      ['share:setRights', { uid: 3, patch: { all: 'edit' } }],
    ]);
  });
});
