import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRunNodes } from '../../tooling/run/src/assembly.mjs';
import { loadRunConfig, startRun, stopRun } from '../../tooling/run/src/lifecycle.mjs';
import { connectRunDaemon, injectLifecycleInfos, mountRunSlice, unmountRunSlice } from '../../tooling/run/src/mount.mjs';
import { runDaemonEffectProvider } from '@graphvideo/sdk/effect';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const studioDir = join(repoRoot, 'app', 'plugins', 'graphvideo.studio');
const daemonExe = process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon';
const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const STUDIO_INSTANCES = [
  'src-fs-source',
  'node-md-source',
  'node-md-parser',
  'node-outliner',
  'n-hist',
  'node-sqlite',
  'sink-sqlite-writer',
  'src-sqlite-observer',
  'node-sec-gate',
  'node-generation-model-resolver',
  'node-generation-task',
  'sink-generation-submit',
  'src-generation-poll',
  'src-generation-poll-scheduler',
  'sink-generation-download',
  'node-application-lifecycle',
  'host-el',
  'sink-electron-window',
  'src-electron-window',
];

function writeStudioRun(root, document = {}) {
  const directory = join(root, 'studio');
  mkdirSync(join(directory, '.generated', 'runtime'), { recursive: true });
  const payload = {
    version: 1,
    name: 'studio',
    plugins: [{ id: 'graphvideo.studio', path: studioDir }],
    kernel: { bind: '127.0.0.1:0', daemonPath: join(repoRoot, 'packages', 'rust', 'target', 'debug', daemonExe) },
    backend: {},
    frontend: { enabled: false },
    graph: { instances: STUDIO_INSTANCES.map((nodeId) => ({ nodeId })) },
    lifecycle: { initInfos: [], startInfos: [], stopInfos: [] },
    scenarios: null,
    resources: {},
    ...document,
  };
  const configPath = join(directory, 'run.config.json');
  writeFileSync(configPath, JSON.stringify(payload, null, 2));
  return configPath;
}

describe('P6 Studio daemon run cutover', () => {
  it('assembles the full Studio graph with zero unselected Nodes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p6-studio-'));
    temporaryRoots.push(root);
    const configPath = writeStudioRun(root);
    const parsed = loadRunConfig(configPath);
    const { nodes } = await loadRunNodes(parsed);
    expect(nodes.map((node) => node.id).sort()).toEqual([...STUDIO_INSTANCES].sort());
  });

  it('refuses a Studio fragment that hides business Nodes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p6-fragment-'));
    temporaryRoots.push(root);
    const configPath = writeStudioRun(root, {
      graph: { instances: [{ nodeId: 'node-md-source' }] },
    });
    const parsed = loadRunConfig(configPath);
    await expect(loadRunNodes(parsed)).rejects.toThrow('unselected Nodes');
  });

  it('mounts the full Studio graph on the daemon and settles start/shutdown through the lifecycle Node', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p6-lifecycle-'));
    temporaryRoots.push(root);
    const requestId = 'p6-studio-lifecycle-1';
    const configPath = writeStudioRun(root, {
      lifecycle: {
        initInfos: [],
        startInfos: [
          { targetNodeId: 'node-application-lifecycle', info: { type: 'SystemStartRequestedInfo', requestId } },
        ],
        stopInfos: [
          { targetNodeId: 'node-application-lifecycle', info: { type: 'SystemShutdownRequestedInfo', requestId, hasProject: false } },
        ],
      },
    });
    const handle = await startRun(configPath);
    const credential = readFileSync(join(handle.parsed.resources.runtimeDirectory, 'daemon-token'), 'utf8');
    const control = await connectRunDaemon({ address: handle.snapshot.kernel.address, token: credential });
    const worker = await connectRunDaemon({ address: handle.snapshot.kernel.address, token: credential });
    const providerConn = await connectRunDaemon({ address: handle.snapshot.kernel.address, token: credential });
    const workerStop = new AbortController();
    const providerStop = new AbortController();
    const watchdog = setTimeout(() => { workerStop.abort(); providerStop.abort(); }, 25_000);
    try {
      // Headless daemon dependencies: the Node instances already carry
      // in-memory window/file adapters as construction defaults. The provider
      // executes through those same adapter objects: real observation path,
      // no Electron IPC anywhere in this run.
      const { nodes } = await loadRunNodes(handle.parsed);
      const mount = await mountRunSlice({ nodes, control, worker, signal: workerStop.signal });
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
      const missing = capabilities.filter((id) => !adapterById.has(id));
      expect(missing, `missing adapters: ${missing.join(',')}`).toEqual([]);
      const providing = runDaemonEffectProvider(providerConn, {
        signal: providerStop.signal,
        adapters: Object.fromEntries(capabilities.map((id) => [id, (request, context) => (
          adapterById.get(id).execute(request, { signal: providerStop.signal, changeId: context.changeId, nodeId: context.nodeId })
        )])),
      });
      try {
        await injectLifecycleInfos({
          control,
          infos: handle.parsed.lifecycle.startInfos,
          prefix: `studio/start`,
        });
        const started = await control.projection();
        const lifecycleState = started.nodes['node-application-lifecycle'].state;
        expect(lifecycleState, JSON.stringify({ lifecycleState, hostEl: started.nodes['host-el']?.state }))
          .toMatchObject({ phase: 'Ready', requestId });
        expect(started.nodes['host-el'].state.isWindowOpen).toBe(true);
        await injectLifecycleInfos({
          control,
          infos: handle.parsed.lifecycle.stopInfos,
          prefix: `studio/stop`,
        });
        const stopping = await control.projection();
        expect(stopping.nodes['node-application-lifecycle'].state).toMatchObject({ phase: 'StoppingGeneration', requestId });
        const inspected = await control.agentInspect(0, 1000);
        expect(JSON.stringify(inspected)).toContain('StudioLifecycleParticipantPreparedInfo');
      } finally {
        providerStop.abort();
        await providing.catch(() => undefined);
        providerConn.close();
        await unmountRunSlice({
          control, workerStop, running: mount.running, admitted: mount.admitted, assemblies: mount.assemblies,
        });
      }
      worker.close();
      try { await control.shutdown(); } catch { /* already closed */ }
      control.close();
    } finally {
      clearTimeout(watchdog);
      handle.stopKernel();
      handle.releaseLock();
      stopRun(handle.parsed.configPath);
    }
  }, 60_000);
});
