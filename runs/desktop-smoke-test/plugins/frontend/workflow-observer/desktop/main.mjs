import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultValueCodec } from '@graphframework/sdk/protocol';
import { serveRunControl, callRunControl } from '../../../../../../packages/tooling/run/index.mjs';
import { selectWatchedFields, selectWatchedInfos } from './watch.mjs';

const context = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const runtime = context.runtimeDirectory;
const token = readFileSync(join(runtime, 'control-token'), 'utf8').trim();
const watches = JSON.parse(readFileSync(join(context.pluginDirectory, 'observer.watch.json'), 'utf8'));

process.on('uncaughtException', (err) => console.error('[Observer Host UncaughtException]', err?.stack ?? err));
process.on('unhandledRejection', (err) => console.error('[Observer Host UnhandledRejection]', err?.stack ?? err));
app.on('window-all-closed', () => console.log('[Observer Host] window-all-closed'));

let mainWindow = null;
let stopped = false;

const graphName = context.instance.graph ?? null;
let infoCursor = 0;
let infoEvents = [];
let infoHistoryTruncated = false;

function decodeNodes(raw) {
  const nodes = [];
  for (const [key, value] of Object.entries(raw.nodes ?? {})) {
    nodes.push({ nodeId: key, state: defaultValueCodec.decode(value.state) ?? {} });
  }
  return nodes;
}

async function getObserverSnapshot() {
  try {
    const [raw, inspected] = await Promise.all([
      callRunControl(runtime, 'projection'),
      callRunControl(runtime, 'inspect', { after: infoCursor, limit: 1000 }),
    ]);
    const nodes = decodeNodes(raw);
    const pendingOwner = nodes.find((n) => n.state && n.state.pendingConfirmation);
    if (inspected.events?.truncated) {
      infoEvents = [];
      infoHistoryTruncated = true;
    }
    const incoming = inspected.events?.events ?? [];
    infoEvents = [...infoEvents, ...incoming].slice(-300);
    infoCursor = inspected.events?.nextCursor ?? infoCursor;
    return {
      revision: raw.revision ?? 0,
      graph: graphName,
      nodes,
      watchedFields: selectWatchedFields(nodes, watches.fields),
      watchedInfos: selectWatchedInfos(infoEvents, watches.infos),
      infoHistoryTruncated,
      pendingConfirmation: pendingOwner
        ? { nodeId: pendingOwner.nodeId, ...pendingOwner.state.pendingConfirmation }
        : null,
      sessionStatus: nodes.find((n) => n.nodeId.endsWith('/session'))?.state?.status ?? null,
    };
  } catch (err) {
    return {
      revision: 0,
      graph: graphName,
      nodes: [],
      watchedFields: [],
      watchedInfos: [],
      infoHistoryTruncated: false,
      pendingConfirmation: null,
      sessionStatus: null,
      lastError: err?.message ?? String(err),
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
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
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

  ipcMain.handle('observer:read-state', async () => getObserverSnapshot());
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
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 11 } : undefined,
    autoHideMenuBar: true,
    backgroundColor: '#0c0e12',
    title: 'GraphFramework · 工作流观察',
    webPreferences: {
      preload: join(context.pluginDirectory, 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Observer Renderer L${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[Observer Renderer did-fail-load] ${errorCode}: ${errorDescription}`);
  });

  mainWindow.loadFile(context.rendererFile);

  mainWindow.on('close', (event) => {
    console.log('[Observer Host] mainWindow close event, stopped:', stopped);
    if (!stopped) {
      callRunControl(runtime, 'request-stop').catch((err) => console.error('[Observer Host] request-stop error:', err));
    }
  });
}

startHost().catch((err) => {
  console.error('Failed to start workflow observer frontend host:', err);
  app.exit(1);
});
