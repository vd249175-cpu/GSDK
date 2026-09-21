const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('recorder', {
  readState: () => ipcRenderer.invoke('recorder:read-state'),
  start: (sessionId, sources) => ipcRenderer.invoke('recorder:start', sessionId, sources),
  stop: () => ipcRenderer.invoke('recorder:stop'),
  openArtifact: () => ipcRenderer.invoke('recorder:open-artifact'),
  openPath: (targetPath) => ipcRenderer.invoke('recorder:open-path', targetPath),
  launchBrowser: () => ipcRenderer.invoke('recorder:launch-browser'),
  copyToClipboard: (text) => ipcRenderer.invoke('recorder:copy-to-clipboard', text),
})

contextBridge.exposeInMainWorld('shell', {
  minimize: () => ipcRenderer.send('shell:minimize'),
  toggleMaximize: () => ipcRenderer.send('shell:toggle-maximize'),
  close: () => ipcRenderer.send('shell:close'),
})
