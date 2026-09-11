import { app, BrowserWindow, ipcMain } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNativeGraphHost } from './native-graph-host.mjs'
import plugin from '../plugins/hello-counter/backend.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// 主进程是唯一 Runtime 所有者；renderer 通道只暴露固定命令，
// 不接受任意 targetNodeId/Info（授权见插件 rendererRoots）。
const host = createNativeGraphHost({ plugins: [plugin] })
host.mount(plugin.createNodes({}))
ipcMain.handle('counter/increment', () => host.injectCounter())
ipcMain.handle('counter/state', () => host.readCounter())
async function createWindow() {
  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    // 无边框 + 自绘三键（样式见 renderer/src/app.css）。
    // 窗口操作是图外桌面服务，直接调 BrowserWindow，不进图。
    frame: false,
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 11 } : undefined,
    backgroundColor: '#080a0d',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
    },
  })
  ipcMain.on('window:minimize', () => window.minimize())
  ipcMain.on('window:toggle-maximize', () => {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on('window:close', () => window.close())
  if (process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    await window.loadFile(join(here, '../renderer-dist/index.html'))
  }
}

void app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  void host.dispose()
  if (process.platform !== 'darwin') app.quit()
})
