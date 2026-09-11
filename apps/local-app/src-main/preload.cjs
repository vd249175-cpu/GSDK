const { contextBridge, ipcRenderer } = require('electron')

/**
 * 预加载桥（沙箱 preload 只支持 CJS，故用 .cjs）：renderer 只能调用固定
 * 计数器命令（读到 Projection 派生 DTO）与窗口三键这类图外桌面服务。
 * 不暴露任意 inject/read，不触及 Kernel 与 Node 私有 State。
 */
contextBridge.exposeInMainWorld('graph', {
  incrementCounter: () => ipcRenderer.invoke('counter/increment'),
  readCounter: () => ipcRenderer.invoke('counter/state'),
})
contextBridge.exposeInMainWorld('shell', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
})
