import { app, BrowserWindow, ipcMain } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultValueCodec } from '@graphframework/sdk/protocol';
import { serveRunControl, callRunControl } from '../../../../../packages/tooling/run/src/control.mjs';

const context = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const runtime = context.runtimeDirectory;
const token = readFileSync(join(runtime, 'control-token'), 'utf8').trim();

let mainWindow = null;
let orderCount = 1;
let stopped = false;

async function getDemoSnapshot() {
  try {
    const raw = await callRunControl(runtime, 'projection');
    const graphPrefix = `${context.instance.graph ?? 'topology'}/`;
    const nodes = [];
    let placedCount = 0;

    for (const [key, value] of Object.entries(raw.nodes ?? {})) {
      const localId = key.startsWith(graphPrefix) ? key.slice(graphPrefix.length) : key;
      const decodedState = defaultValueCodec.decode(value.state);
      const demoId = `demo.${localId}`;
      nodes.push({
        nodeId: demoId,
        generation: value.generation ?? 0,
        state: decodedState ?? {},
      });
      if (localId === 'orders') placedCount = decodedState.placed ?? 0;
    }

    const edges = [
      { from: 'demo.orders', to: 'demo.router' },
      { from: 'demo.router', to: 'demo.billing' },
      { from: 'demo.router', to: 'demo.inventory' },
      { from: 'demo.billing', to: 'demo.ledger' },
      { from: 'demo.inventory', to: 'demo.ledger' },
    ];

    let phase = 0;
    let phaseLabel = '星盘初启·众神就位';
    if (placedCount >= 1) {
      phase = 1;
      phaseLabel = '因果奔涌·双星入账';
    }

    return {
      phase,
      phaseLabel,
      revision: raw.revision ?? Object.values(raw.nodes ?? {}).reduce((s, n) => s + (n.version ?? 0), 0),
      nodes,
      edges,
    };
  } catch (err) {
    return {
      phase: 0,
      phaseLabel: '连接中…',
      revision: 0,
      nodes: [],
      edges: [],
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

  ipcMain.handle('demo:read-state', async () => getDemoSnapshot());
  ipcMain.handle('demo:step', async () => {
    orderCount += 1;
    const orderId = `order-${orderCount}`;
    const graphName = context.instance.graph ?? 'topology';
    await callRunControl(runtime, 'inject-renderer', {
      targetNodeId: `${graphName}/orders`,
      info: { type: 'SubmitOrder', orderId },
    });
    return getDemoSnapshot();
  });
  ipcMain.handle('demo:reset', async () => getDemoSnapshot());

  ipcMain.handle('graph:read-counter', async () => {
    const snapshot = await getDemoSnapshot();
    const orders = snapshot.nodes.find((n) => n.nodeId === 'demo.orders');
    return { count: orders?.state?.placed ?? 0 };
  });
  ipcMain.handle('graph:increment-counter', async () => {
    orderCount += 1;
    const orderId = `order-${orderCount}`;
    const graphName = context.instance.graph ?? 'topology';
    await callRunControl(runtime, 'inject-renderer', {
      targetNodeId: `${graphName}/orders`,
      info: { type: 'SubmitOrder', orderId },
    });
    const snapshot = await getDemoSnapshot();
    const orders = snapshot.nodes.find((n) => n.nodeId === 'demo.orders');
    return { count: orders?.state?.placed ?? 0 };
  });

  ipcMain.on('shell:minimize', () => mainWindow?.minimize());
  ipcMain.on('shell:toggle-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('shell:close', () => {
    callRunControl(runtime, 'request-stop').catch(() => {});
  });

  await app.whenReady();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0c0e12',
    title: 'GraphFramework Demo · DaVinci Workbench',
    webPreferences: {
      preload: join(context.pluginDirectory, 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(context.rendererFile);

  mainWindow.on('close', (event) => {
    if (!stopped) {
      callRunControl(runtime, 'request-stop').catch(() => {});
    }
  });
}

startHost().catch((err) => {
  console.error('Failed to start demo frontend host:', err);
  app.exit(1);
});
