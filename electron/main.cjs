const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fss = require('fs');

const isDev = !app.isPackaged;
app.setName('Doska');

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
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
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
      out.push({ id: b.id, name: b.name, createdAt: b.createdAt, updatedAt: b.updatedAt });
    } catch { /* битый файл пропускаем */ }
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
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
