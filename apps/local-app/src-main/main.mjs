import { app, BrowserWindow, ipcMain } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNativeGraphHost } from './native-graph-host.mjs'
import { createDemoController } from './demo-controller.mjs'
import plugin from '../plugins/hello-counter/backend.mjs'
import demoPlugin from '../plugins/demo-topology/backend.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// 主进程是唯一 Runtime 所有者；renderer 通道只暴露固定命令，
// 不接受任意 targetNodeId/Info（授权见插件 rendererRoots）。
const host = createNativeGraphHost({ plugins: [plugin, demoPlugin] })
host.mount(plugin.createNodes({}))
ipcMain.handle('counter/increment', () => host.injectCounter())
ipcMain.handle('counter/state', () => host.readCounter())
// 演示拓扑与计数器共享同一 RuleSpace；renderer 只能按固定步骤推进/重置，
// 不能指定 Node 或 Info。demo 插件进 plugins 列表只为登记 rendererRoots 备查。
const demo = createDemoController(host)
demo.mountBase()
ipcMain.handle('demo/state', () => demo.readDemo())
ipcMain.handle('demo/step', () => demo.step())
ipcMain.handle('demo/reset', () => demo.reset())
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

async function handleDemoArgv(argv) {
  for (const arg of argv) {
    try {
      if (arg === '--demo-reset') console.log(await demo.applyOp('reset'))
      else if (arg.startsWith('--demo-admit=')) console.log(await demo.applyOp('admit', arg.slice('--demo-admit='.length)))
      else if (arg.startsWith('--demo-evict=')) console.log(await demo.applyOp('evict', arg.slice('--demo-evict='.length)))
    } catch (error) {
      console.error(`[demo-op] rejected ${arg}:`, error?.message ?? error)
    }
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
    void handleDemoArgv(argv)
  })
  void app.whenReady().then(async () => {
    await createWindow()
    await handleDemoArgv(process.argv)
  })
}
app.on('window-all-closed', () => {
  void host.dispose()
  if (process.platform !== 'darwin') app.quit()
})
