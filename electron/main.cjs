const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fss = require('fs');
const { createShareServer, MAX_EDITORS } = require('./share.cjs');

const isDev = !app.isPackaged;

// Приложение называлось Doska, папка профиля по умолчанию идёт от названия (productName).
// Проекты (boards/) и настройки (Local Storage) остаются в прежней папке, иначе после
// обновления до Abax пользователь увидел бы пустой список проектов.
app.setPath('userData', path.join(app.getPath('appData'), 'Doska'));

// Окно демонстрации показывают в видеозвонке, часто спрятанным за основным окном.
// Иначе Chromium на Windows считает перекрытое окно скрытым и перестаёт его рисовать —
// ученик видит застывшую картинку.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

/** Имя окна демонстрации (window.open в src/present.ts). */
const PRESENT_FRAME = 'doska-present';

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html')).catch(err => {
      console.error('[doska] loadFile failed:', err);
      dialog.showErrorBox('Abax — ошибка загрузки', String(err));
    });
  }
  // окно демонстрации: без меню и без троттлинга — оно почти всегда в фоне
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // внешние ссылки (раздел «О проекте») — в браузере системы, а не в окне с нашим preload
    if (frameName !== PRESENT_FRAME && /^https?:\/\//.test(url ?? '')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    if (frameName !== PRESENT_FRAME) return { action: 'allow' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        minWidth: 320,
        minHeight: 200,
        webPreferences: { backgroundThrottling: false },
      },
    };
  });
  win.webContents.on('did-create-window', (child, { frameName }) => {
    if (frameName === PRESENT_FRAME) child.removeMenu();
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[doska] did-fail-load: ${code} ${desc} ${url}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[doska] renderer gone:', details.reason);
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[doska:renderer] ${message} (${sourceId}:${line})`);
  });
}

function boardsDir() {
  const d = path.join(app.getPath('userData'), 'boards');
  fss.mkdirSync(d, { recursive: true });
  return d;
}

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9-]/g, '');
const boardPath = (id) => path.join(boardsDir(), `${safeId(id)}.json`);

ipcMain.handle('boards:list', async () => {
  const files = await fs.readdir(boardsDir());
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const b = JSON.parse(await fs.readFile(path.join(boardsDir(), f), 'utf8'));
      out.push({
        id: b.id, name: b.name, createdAt: b.createdAt, updatedAt: b.updatedAt,
        pageCount: Array.isArray(b.pages) ? b.pages.length : 1,
        ...(b.pinned ? { pinned: true } : {}),
      });
    } catch { /* битый файл пропускаем */ }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
});


ipcMain.handle('pdf:pick', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const buf = await fs.readFile(r.filePaths[0]);
  return 'data:application/pdf;base64,' + buf.toString('base64');
});

ipcMain.handle('image:pick', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const buf = await fs.readFile(r.filePaths[0]);
  const ext = path.extname(r.filePaths[0]).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,` + buf.toString('base64');
});
ipcMain.handle('boards:load', async (_e, id) => {
  try {
    return JSON.parse(await fs.readFile(boardPath(id), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('boards:save', async (_e, board) => {
  const p = boardPath(board.id);
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(board), 'utf8');
  await fs.rename(tmp, p); // атомарная замена
});

ipcMain.handle('boards:delete', async (_e, id) => {
  await fs.rm(boardPath(id), { force: true });
});

ipcMain.handle('export:png', async (_e, { dataUrl, name }) => {
  const r = await dialog.showSaveDialog({
    defaultPath: name,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePath) return false;
  const b64 = dataUrl.split(',')[1];
  await fs.writeFile(r.filePath, Buffer.from(b64, 'base64'));
  return true;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ----- Совместная работа -----
let share = null;
const SHARE_PORT = Number(process.env.DOSKA_SHARE_PORT || 4826);
const os = require('os');

function lanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

function shareInfo() {
  const ip = lanIp();
  return { port: share.port, code: share.code, url: `http://${ip}:${share.port}/?room=${share.code}`, maxEditors: MAX_EDITORS };
}

// hostKey отдаём только в ответ share:start — это секрет автора для host-подключения
ipcMain.handle('share:start', async () => {
  if (share) return { ok: true, ...shareInfo(), hostKey: share.hostKey, users: share.users() };
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  // пробуем базовый порт, затем следующие — не падаем от EADDRINUSE
  for (let p = SHARE_PORT; p < SHARE_PORT + 20; p++) {
    try {
      share = await createShareServer({ port: p, code });
      break;
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }
  if (!share) return { ok: false, error: 'Не удалось найти свободный порт' };
  share.setDistDir(path.join(__dirname, '..', 'dist'));
  return { ok: true, ...shareInfo(), hostKey: share.hostKey, users: share.users() };
});

ipcMain.handle('share:stop', async () => {
  if (share) { share.close(); share = null; }
  return { ok: true };
});

ipcMain.handle('share:status', async () => share ? { active: true, ...shareInfo(), users: share.users() } : { active: false });

ipcMain.handle('share:setRights', async (_e, { uid, patch }) => {
  if (!share) return { ok: false, error: 'Совместная работа выключена' };
  return share.setRights(uid, patch);
});

ipcMain.handle('share:openTestWindow', async () => {
  if (!share) return { ok: false };
  const w = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  await w.loadURL(`http://127.0.0.1:${share.port}/?room=${share.code}&name=${encodeURIComponent('Тест-гость')}`);
  return { ok: true };
});
