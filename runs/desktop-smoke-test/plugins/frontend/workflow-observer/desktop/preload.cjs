const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('observer', {
  readState: () => ipcRenderer.invoke('observer:read-state'),
});

contextBridge.exposeInMainWorld('shell', {
  minimize: () => ipcRenderer.send('shell:minimize'),
  toggleMaximize: () => ipcRenderer.send('shell:toggle-maximize'),
  close: () => ipcRenderer.send('shell:close'),
});
