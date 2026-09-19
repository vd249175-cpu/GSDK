const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('demo', {
  readState: () => ipcRenderer.invoke('demo/readState'),
  step: () => ipcRenderer.invoke('demo/step'),
  reset: () => ipcRenderer.invoke('demo/reset'),
});

contextBridge.exposeInMainWorld('graph', {
  readCounter: () => ipcRenderer.invoke('graph/readCounter'),
  incrementCounter: () => ipcRenderer.invoke('graph/incrementCounter'),
});

contextBridge.exposeInMainWorld('shell', {
  minimize: () => ipcRenderer.send('window/minimize'),
  toggleMaximize: () => ipcRenderer.send('window/toggleMaximize'),
  close: () => ipcRenderer.send('window/close'),
});
