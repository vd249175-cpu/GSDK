import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRunNodes } from '../../tooling/run/src/assembly.mjs';
import { loadRunConfig, startRun, stopRun } from '../../tooling/run/src/lifecycle.mjs';
import { connectRunDaemon, injectLifecycleInfos, mountRunSlice, unmountRunSlice } from '../../tooling/run/src/mount.mjs';
import { runDaemonEffectProvider } from '@graphvideo/sdk/effect';
import { runScenarioSet, writeScenarioReport } from '../../tooling/run/src/scenario.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const helloCounterDir = join(repoRoot, 'app', 'plugins', 'hello-counter');
const studioDir = join(repoRoot, 'app', 'plugins', 'graphvideo.studio');
const daemonExe = process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon';
const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const STUDIO_INSTANCES = [
  'src-fs-source', 'node-md-source', 'node-md-parser', 'node-outliner', 'n-hist',
  'node-sqlite', 'sink-sqlite-writer', 'src-sqlite-observer', 'node-sec-gate',
  'node-generation-model-resolver', 'node-generation-task', 'sink-generation-submit',
  'src-generation-poll', 'src-generation-poll-scheduler', 'sink-generation-download',
  'node-application-lifecycle', 'host-el', 'sink-electron-window', 'src-electron-window',
];

function writeRun(root, name, document) {
  const directory = join(root, name);
  mkdirSync(join(directory, '.generated', 'runtime'), { recursive: true });
  const configPath = join(directory, 'run.config.json');
  writeFileSync(configPath, JSON.stringify(document, null, 2));
  return configPath;
}

async function startSlice(configPath, { withProvider = false } = {}) {
  const handle = await startRun(configPath);
  const credential = readFileSync(join(handle.parsed.resources.runtimeDirectory, 'daemon-token'), 'utf8');
  const control = await connectRunDaemon({ address: handle.snapshot.kernel.address, token: credential });
  const worker = await connectRunDaemon({ address: handle.snapshot.kernel.address, token: credential });
  const workerStop = new AbortController();
  const watchdog = setTimeout(() => workerStop.abort(), 55_000);
  const { nodes } = await loadRunNodes(handle.parsed);
  const mount = await mountRunSlice({ nodes, control, worker, signal: workerStop.signal });
  let provider = null;
  if (withProvider) {
    const providerConn = await connectRunDaemon({ address: handle.snapshot.kernel.address, token: credential });
    const providerStop = new AbortController();
    const capabilities = [...new Set(mount.assemblies.flatMap((assembly) => assembly.effectCapabilities ?? []))];
    const adapterById = new Map();
    for (const node of nodes) {
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
          && typeof value.execute === 'function') {
          adapterById.set(value.id, value);
        }
      }
    }
    provider = {
      conn: providerConn,
      stop: providerStop,
      running: runDaemonEffectProvider(providerConn, {
        signal: providerStop.signal,
        adapters: Object.fromEntries(capabilities.map((id) => [id, (request, context) => (
          adapterById.get(id).execute(request, { signal: providerStop.signal, changeId: context.changeId, nodeId: context.nodeId })
        )])),
      }),
    };
  }
  return { handle, control, worker, workerStop, watchdog, mount, provider };
}

async function stopSlice(slice) {
  clearTimeout(slice.watchdog);
  if (slice.provider) {
    slice.provider.stop.abort();
    await slice.provider.running.catch(() => undefined);
    slice.provider.conn.close();
  }
  await unmountRunSlice({
    control: slice.control, workerStop: slice.workerStop,
    running: slice.mount.running, admitted: slice.mount.admitted, assemblies: slice.mount.assemblies,
  });
  slice.worker.close();
  try { await slice.control.shutdown(); } catch { /* already closed */ }
  slice.control.close();
  slice.handle.stopKernel();
  slice.handle.releaseLock();
  stopRun(slice.handle.parsed.configPath);
}

describe('P7 three-run drill: studio plus two agent runs', () => {
  it('runs the full Studio graph and two counter slices in parallel without sharing endpoints, state or records', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p7-drill-'));
    temporaryRoots.push(root);
    const daemonPath = join(repoRoot, 'packages', 'rust', 'target', 'debug', daemonExe);
    const studioConfig = writeRun(root, 'studio', {
      version: 1, name: 'studio',
      plugins: [{ id: 'graphvideo.studio', path: studioDir }],
      kernel: { bind: '127.0.0.1:0', daemonPath },
      backend: {}, frontend: { enabled: false },
      graph: { instances: STUDIO_INSTANCES.map((nodeId) => ({ nodeId })) },
      lifecycle: {
        initInfos: [],
        startInfos: [
          { targetNodeId: 'node-application-lifecycle', info: { type: 'SystemStartRequestedInfo', requestId: 'p7-studio-1' } },
        ],
        stopInfos: [],
      },
      scenarios: [{
        name: 'studio-ready',
        inputs: [],
        assertions: [{ nodeId: 'node-application-lifecycle', state: { phase: 'Ready' } }],
      }],
      resources: {},
    });
    const aliceConfig = writeRun(root, 'alice', {
      version: 1, name: 'alice',
      plugins: [{ id: 'example.hello-counter', path: helloCounterDir }],
      kernel: { bind: '127.0.0.1:0', daemonPath },
      backend: {}, frontend: { enabled: false },
      graph: { instances: [{ nodeId: 'example.counter' }] },
      lifecycle: {
        initInfos: [{ targetNodeId: 'example.counter', info: { type: 'IncrementInfo' } }],
        startInfos: [],
        stopInfos: [],
      },
      scenarios: [{
        name: 'alice-counts-once',
        inputs: [],
        assertions: [{ nodeId: 'example.counter', state: { count: 1 }, version: 1 }],
      }],
      resources: {},
    });
    const taskConfig = writeRun(root, 'task-42', {
      version: 1, name: 'task-42',
      plugins: [{ id: 'example.hello-counter', path: helloCounterDir }],
      kernel: { bind: '127.0.0.1:0', daemonPath },
      backend: {}, frontend: { enabled: false },
      graph: { instances: [{ nodeId: 'example.counter' }] },
      lifecycle: {
        initInfos: [
          { targetNodeId: 'example.counter', info: { type: 'IncrementInfo' } },
          { targetNodeId: 'example.counter', info: { type: 'IncrementInfo' } },
        ],
        startInfos: [],
        stopInfos: [],
      },
      scenarios: [{
        name: 'task-counts-twice',
        inputs: [],
        assertions: [{ nodeId: 'example.counter', state: { count: 2 }, version: 2 }],
      }],
      resources: {},
    });

    const studio = await startSlice(studioConfig, { withProvider: true });
    const alice = await startSlice(aliceConfig);
    const task = await startSlice(taskConfig);
    try {
      expect(new Set([
        studio.handle.snapshot.kernel.address,
        alice.handle.snapshot.kernel.address,
        task.handle.snapshot.kernel.address,
      ]).size).toBe(3);

      await injectLifecycleInfos({ control: studio.control, infos: studio.handle.parsed.lifecycle.startInfos, prefix: 'studio/start' });
      await injectLifecycleInfos({ control: alice.control, infos: alice.handle.parsed.lifecycle.initInfos, prefix: 'alice/init' });
      await injectLifecycleInfos({ control: task.control, infos: task.handle.parsed.lifecycle.initInfos, prefix: 'task-42/init' });

      for (const slice of [studio, alice, task]) {
        const report = await runScenarioSet({
          parsed: slice.handle.parsed,
          runName: slice.handle.snapshot.runName,
          submitInfos: async (targetNodeId, info, submissionId) => slice.control.inject(targetNodeId, info, submissionId),
          readProjection: async () => slice.control.projection(),
        });
        expect(report.failed).toBe(0);
        writeScenarioReport(slice.handle.parsed.resources.logsDirectory, slice.handle.snapshot.runName, report);
      }

      const [aliceProjection, taskProjection, studioProjection] = await Promise.all([
        alice.control.projection(), task.control.projection(), studio.control.projection(),
      ]);
      expect(aliceProjection.nodes['example.counter'].state).toMatchObject({ count: 1 });
      expect(taskProjection.nodes['example.counter'].state).toMatchObject({ count: 2 });
      expect(studioProjection.nodes['node-application-lifecycle'].state.phase).toBe('Ready');

      await stopSlice(alice);
      expect(readFileSync(join(task.handle.parsed.resources.runtimeDirectory, 'daemon-token'), 'utf8').length).toBeGreaterThan(0);
      const stillThere = await task.control.projection();
      expect(stillThere.nodes['example.counter'].state).toMatchObject({ count: 2 });
      alice.stopped = true;
    } finally {
      await stopSlice(studio).catch(() => undefined);
      await stopSlice(task).catch(() => undefined);
      if (!alice.stopped) await stopSlice(alice).catch(() => undefined);
    }
  }, 120_000);
});
