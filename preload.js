const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scout', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  testConfig: (cfg) => ipcRenderer.invoke('config:test', cfg),
  run: (args) => ipcRenderer.invoke('agent:run', args),
  stop: (sessionId) => ipcRenderer.invoke('agent:stop', sessionId),
  onEvent: (fn) => ipcRenderer.on('agent:event', (_e, ev) => fn(ev)),
  listHistory: () => ipcRenderer.invoke('history:list'),
  getSession: (id) => ipcRenderer.invoke('history:get', id),
  saveSession: (s) => ipcRenderer.invoke('history:save', s),
  deleteSession: (id) => ipcRenderer.invoke('history:delete', id),
  exportReport: (args) => ipcRenderer.invoke('export', args),
});
