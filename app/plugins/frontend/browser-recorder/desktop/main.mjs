import { app, BrowserWindow, Menu, ipcMain, clipboard } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultValueCodec } from '@graphframework/sdk/protocol';
import { serveRunControl, callRunControl } from '../../../../../packages/tooling/run/src/control.mjs';

const execFileAsync = promisify(execFile);
const context = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const runtime = context.runtimeDirectory;
const token = readFileSync(join(runtime, 'control-token'), 'utf8').trim();

process.on('uncaughtException', (err) => console.error('[BrowserRecorder Host UncaughtException]', err?.stack ?? err));
process.on('unhandledRejection', (err) => console.error('[BrowserRecorder Host UnhandledRejection]', err?.stack ?? err));
app.on('window-all-closed', () => console.log('[BrowserRecorder Host] window-all-closed'));

let mainWindow = null;
let stopped = false;

let isPolling = false;

async function getSessionSnapshot() {
  try {
    const graphPrefix = `${context.instance.graph ?? 'recorder'}/`;
    let raw = await callRunControl(runtime, 'projection');
    let nodeEntry = raw.nodes?.[`${graphPrefix}session`] ?? raw.nodes?.['example.browser-recorder/session'];
    let decodedState = defaultValueCodec.decode(nodeEntry?.state) ?? {};

    if (decodedState.status === 'recording' && !isPolling) {
      isPolling = true;
      try {
        await callRunControl(runtime, 'inject-host', {
          frontendId: context.instance.id ?? 'recorder-ui',
          targetNodeId: `${graphPrefix}observation`,
          info: { type: 'PollRecordingEventsInfo', sessionId: decodedState.sessionId },
        });
        raw = await callRunControl(runtime, 'projection');
        nodeEntry = raw.nodes?.[`${graphPrefix}session`] ?? raw.nodes?.['example.browser-recorder/session'];
        decodedState = defaultValueCodec.decode(nodeEntry?.state) ?? {};
      } catch {
        // ignore poll errors
      } finally {
        isPolling = false;
      }
    }

    return {
      status: decodedState.status ?? 'idle',
      sessionId: decodedState.sessionId ?? null,
      handle: decodedState.handle ?? null,
      lastActions: decodedState.lastActions ?? null,
      eventCount: decodedState.eventCount ?? 0,
      lastEvent: decodedState.lastEvent ?? null,
      lastError: decodedState.lastError ?? null,
      revision: raw.revision ?? 0,
    };
  } catch (err) {
    return {
      status: 'idle',
      sessionId: null,
      handle: null,
      lastActions: null,
      eventCount: 0,
      lastEvent: null,
      lastError: err?.message ?? '读取状态失败',
      revision: 0,
    };
  }
}

async function startHost() {
  const server = await serveRunControl({
    token,
    runId: context.runId,
    handlers: {
      health: () => ({ runId: context.runId, pid: process.pid, instanceId: context.instance.id }),
      ready: async () => ({ ready: true }),
      gate: async () => ({ gated: true }),
      'stop-sources': async () => ({ stopped: true }),
      close: async () => {
        stopped = true;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
        setImmediate(async () => {
          await server.close();
          app.quit();
        });
        return { closed: true };
      },
    },
  });

  writeFileSync(
    join(runtime, `frontend-${context.instance.id}.json`),
    JSON.stringify({ runId: context.runId, address: server.address, pid: process.pid })
  );

  ipcMain.handle('recorder:read-state', async () => getSessionSnapshot());

  ipcMain.handle('recorder:start', async (_event, sessionId) => {
    const graphName = context.instance.graph ?? 'recorder';
    const sId = typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : `rec-${Date.now()}`;
    await callRunControl(runtime, 'inject-renderer', {
      targetNodeId: `${graphName}/session`,
      info: { type: 'StartRecordingInfo', sessionId: sId },
    });
    return getSessionSnapshot();
  });

  ipcMain.handle('recorder:stop', async () => {
    const graphName = context.instance.graph ?? 'recorder';
    await callRunControl(runtime, 'inject-renderer', {
      targetNodeId: `${graphName}/session`,
      info: { type: 'StopRecordingInfo' },
    });
    return getSessionSnapshot();
  });

  ipcMain.handle('recorder:launch-browser', async () => {
    try {
      const scriptPath = join(context.pluginDirectory, '../../../../.agents/skills/browser-setup/scripts/browser.ps1');
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Action',
        'Start',
      ], { timeout: 30000 });
      return { ok: true, output: stdout };
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('recorder:copy-to-clipboard', async (_event, text) => {
    if (typeof text === 'string') {
      clipboard.writeText(text);
      return { ok: true };
    }
    return { ok: false };
  });

  ipcMain.on('shell:minimize', () => mainWindow?.minimize());
  ipcMain.on('shell:toggle-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('shell:close', () => {
    callRunControl(runtime, 'request-stop').catch(() => {});
  });

  Menu.setApplicationMenu(null);
  const isMac = process.platform === 'darwin';

  await app.whenReady();

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 550,
    frame: false,
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 11 } : undefined,
    autoHideMenuBar: true,
    backgroundColor: '#0c0e12',
    title: 'GraphFramework · 浏览器录制工作台',
    webPreferences: {
      preload: join(context.pluginDirectory, 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenu(null);

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer L${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.loadFile(context.rendererFile);

  mainWindow.on('close', () => {
    if (!stopped) {
      callRunControl(runtime, 'request-stop').catch((err) => console.error('[Host] request-stop error:', err));
    }
  });
}

startHost().catch((err) => {
  console.error('Failed to start browser recorder frontend host:', err);
  app.exit(1);
});
