const { contextBridge, ipcRenderer } = require('electron');

if (process.argv.includes('--abax-window-titlebar')) {
  window.addEventListener('DOMContentLoaded', () => {
    const titlebar = document.getElementById('desktop-titlebar');
    if (!titlebar) return;

    const maximize = titlebar.querySelector('[data-window-action="maximize"]');
    const updateMaximized = (maximized) => {
      const label = maximized ? 'Восстановить размер окна' : 'Развернуть окно';
      maximize.dataset.maximized = String(maximized);
      maximize.title = label;
      maximize.setAttribute('aria-label', label);
    };
    ipcRenderer.on('window:maximized', (_event, maximized) => updateMaximized(maximized));
    void ipcRenderer.invoke('window:control', 'status').then(updateMaximized);
    for (const button of titlebar.querySelectorAll('[data-window-action]')) {
      button.addEventListener('click', () => {
        void ipcRenderer.invoke('window:control', button.dataset.windowAction);
      });
    }
    titlebar.addEventListener('pointerover', (event) => {
      titlebar.toggleAttribute('data-mouse-hover', event.pointerType === 'mouse');
    });
    titlebar.hidden = false;
  }, { once: true });
}

contextBridge.exposeInMainWorld('doskaAPI', {
  list: () => ipcRenderer.invoke('boards:list'),
  load: (id) => ipcRenderer.invoke('boards:load', id),
  save: (board) => ipcRenderer.invoke('boards:save', board),
  remove: (id) => ipcRenderer.invoke('boards:delete', id),
  exportPng: (dataUrl, name) => ipcRenderer.invoke('export:png', { dataUrl, name }),
  copyImage: (dataUrl) => ipcRenderer.invoke('clipboard:image', dataUrl),
  pickPdf: () => ipcRenderer.invoke('pdf:pick'),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  shareStart: () => ipcRenderer.invoke('share:start'),
  shareStop: () => ipcRenderer.invoke('share:stop'),
  shareStatus: () => ipcRenderer.invoke('share:status'),
  shareSetRights: (uid, patch) => ipcRenderer.invoke('share:setRights', { uid, patch }),
  shareOpenTestWindow: () => ipcRenderer.invoke('share:openTestWindow'),
  shareCloudStart: (opts) => ipcRenderer.invoke('share:cloudStart', opts),
  shareCloudStop: () => ipcRenderer.invoke('share:cloudStop'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  setAppIcon: (png) => ipcRenderer.invoke('app:setIcon', png),
});
