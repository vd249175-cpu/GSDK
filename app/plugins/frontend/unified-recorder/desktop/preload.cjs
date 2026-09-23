const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('recorder', {
  readState: () => ipcRenderer.invoke('recorder:read-state'),
  start: (sessionId, sources) => ipcRenderer.invoke('recorder:start', sessionId, sources),
  stop: () => ipcRenderer.invoke('recorder:stop'),
  openArtifact: () => ipcRenderer.invoke('recorder:open-artifact'),
  openPath: (targetPath) => ipcRenderer.invoke('recorder:open-path', targetPath),
  launchBrowser: () => ipcRenderer.invoke('recorder:launch-browser'),
  copyToClipboard: (text) => ipcRenderer.invoke('recorder:copy-to-clipboard', text),
  readImage: (targetPath) => ipcRenderer.invoke('recorder:read-image', targetPath),
  saveAudio: (payload) => ipcRenderer.invoke('recorder:save-audio', payload),
  correctSubtitle: (id, text) => ipcRenderer.invoke('recorder:correct-subtitle', id, text),
  readAudio: (sessionId) => ipcRenderer.invoke('recorder:read-audio', sessionId),
  openNarration: () => ipcRenderer.invoke('recorder:open-narration'),
  pauseNotice: () => ipcRenderer.invoke('recorder:pause-notice'),
})

contextBridge.exposeInMainWorld('shell', {
  minimize: () => ipcRenderer.send('shell:minimize'),
  toggleMaximize: () => ipcRenderer.send('shell:toggle-maximize'),
  close: () => ipcRenderer.send('shell:close'),
})
