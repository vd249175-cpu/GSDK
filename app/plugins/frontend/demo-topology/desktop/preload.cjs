const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('graph', {
  readCounter: () => ipcRenderer.invoke('graph:read-counter'),
  incrementCounter: () => ipcRenderer.invoke('graph:increment-counter'),
});

contextBridge.exposeInMainWorld('demo', {
  readState: () => ipcRenderer.invoke('demo:read-state'),
  step: () => ipcRenderer.invoke('demo:step'),
  reset: () => ipcRenderer.invoke('demo:reset'),
});

contextBridge.exposeInMainWorld('shell', {
  minimize: () => ipcRenderer.send('shell:minimize'),
  toggleMaximize: () => ipcRenderer.send('shell:toggle-maximize'),
  close: () => ipcRenderer.send('shell:close'),
});
