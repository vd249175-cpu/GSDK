const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorder', {
  readState: () => ipcRenderer.invoke('recorder:read-state'),
  start: (sessionId) => ipcRenderer.invoke('recorder:start', sessionId),
  stop: () => ipcRenderer.invoke('recorder:stop'),
  launchBrowser: () => ipcRenderer.invoke('recorder:launch-browser'),
  copyToClipboard: (text) => ipcRenderer.invoke('recorder:copy-to-clipboard', text),
});

contextBridge.exposeInMainWorld('shell', {
  minimize: () => ipcRenderer.send('shell:minimize'),
  toggleMaximize: () => ipcRenderer.send('shell:toggle-maximize'),
  close: () => ipcRenderer.send('shell:close'),
});
