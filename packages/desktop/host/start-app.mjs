import { app, BrowserWindow, ipcMain } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { NativeRuleSpace } from '@graphframework/sdk/node';
import { createDemoController } from '../../../app/plugins/backend/demo-topology/desktop/demo-controller.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(__dirname, '..');
const preloadPath = join(__dirname, 'preload.cjs');

// Initialize native causal space and demo controller
const space = new NativeRuleSpace();
const controller = createDemoController({ space });
controller.mountBase();

ipcMain.handle('demo/readState', async () => controller.readDemo());
ipcMain.handle('demo/step', async () => controller.step());
ipcMain.handle('demo/reset', async () => controller.reset());
ipcMain.handle('graph/readCounter', async () => ({ count: space.getState('demo.orders')?.placed ?? 0 }));
ipcMain.handle('graph/incrementCounter', async () => {
  const sub = space.injectRoot('demo.orders', { type: 'SubmitOrder', orderId: `order-manual-${Date.now()}` });
  await space.waitForSubmission(sub);
  return { count: space.getState('demo.orders')?.placed ?? 0 };
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'GraphFramework Desktop · DaVinci Creative Suite',
    backgroundColor: '#0d1117',
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  ipcMain.on('window/minimize', () => win.minimize());
  ipcMain.on('window/toggleMaximize', () => { if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  ipcMain.on('window/close', () => win.close());

  const rendererHtml = join(desktopRoot, 'dist/renderer/index.html');
  if (existsSync(rendererHtml)) {
    await win.loadFile(rendererHtml);
  } else {
    console.log('[Desktop] Loading dev server at http://localhost:5173/ ...');
    await win.loadURL('http://localhost:5173/');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
