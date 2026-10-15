const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('doskaAPI', {
  list: () => ipcRenderer.invoke('boards:list'),
  load: (id) => ipcRenderer.invoke('boards:load', id),
  save: (board) => ipcRenderer.invoke('boards:save', board),
  remove: (id) => ipcRenderer.invoke('boards:delete', id),
  exportPng: (dataUrl, name) => ipcRenderer.invoke('export:png', { dataUrl, name }),
  pickPdf: () => ipcRenderer.invoke('pdf:pick'),
});
