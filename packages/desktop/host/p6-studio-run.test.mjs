import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRunNodes } from '../../tooling/run/src/assembly.mjs';
import { loadRunConfig, startRun, statusRun, stopRun } from '../../tooling/run/src/lifecycle.mjs';
import { connectRunDaemon } from '../../tooling/run/src/mount.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const studioDir = join(repoRoot, 'app', 'plugins', 'backend', 'graphvideo.studio');
const daemonExe = process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon';
const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const STUDIO_LOCALS = [
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
const studioId = (local) => `studio/${local}`;
const STUDIO_INSTANCES = STUDIO_LOCALS.map(studioId);

function writeStudioRun(root, document = {}) {
  const directory = join(root, 'studio');
  mkdirSync(join(directory, '.generated', 'runtime'), { recursive: true });
  const payload = {
    version: 2,
    name: 'studio',
    plugins: { backend: [{ id: 'graphvideo.studio', path: studioDir }], frontend: [] },
    kernel: { bind: '127.0.0.1:0', daemonPath: join(repoRoot, 'packages', 'rust', 'target', 'debug', daemonExe) },
    backend: { dependencies: {} },
    frontend: { instances: [] },
    graph: {
      instances: [
        { kind: 'graph', id: 'studio', factory: { plugin: 'graphvideo.studio', name: 'createStudioNodes' } },
      ],
    },
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

  it('refuses an unknown factory reference', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p6-fragment-'));
    temporaryRoots.push(root);
    const configPath = writeStudioRun(root, {
      graph: { instances: [{ kind: 'graph', id: 'studio', factory: { plugin: 'graphvideo.studio', name: 'noSuchFactory' } }] },
    });
    const parsed = loadRunConfig(configPath);
    await expect(loadRunNodes(parsed)).rejects.toThrow('is not exported');
  });

  it('mounts the full Studio graph on the daemon and settles start/shutdown through the lifecycle Node', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p6-lifecycle-'));
    temporaryRoots.push(root);
    const requestId = 'p6-studio-lifecycle-1';
    const configPath = writeStudioRun(root, {
      lifecycle: {
        initInfos: [],
        startInfos: [
          { targetNodeId: 'studio/node-application-lifecycle', info: { type: 'SystemStartRequestedInfo', requestId } },
        ],
        stopInfos: [
          { targetNodeId: 'studio/node-application-lifecycle', info: { type: 'SystemShutdownRequestedInfo', requestId, hasProject: false } },
        ],
      },
    });
    // startRun owns kernel + slice + provider + init/start settlement.
    const handle = await startRun(configPath);
    const control = await connectRunDaemon({
      address: handle.snapshot.kernel.address,
      token: readFileSync(join(handle.parsed.resources.runtimeDirectory, 'daemon-token'), 'utf8'),
    });
    try {
      const started = await control.projection();
      const lifecycleState = started.nodes['studio/node-application-lifecycle'].state;
      expect(lifecycleState, JSON.stringify({ lifecycleState, hostEl: started.nodes['studio/host-el']?.state }))
        .toMatchObject({ phase: 'Ready', requestId });
      expect(started.nodes['studio/host-el'].state.isWindowOpen).toBe(true);
      // Supervised stop injects stopInfos, settles, evicts, and shuts down.
      await handle.stop();
      control.close();
      expect(statusRun(configPath)).toMatchObject({ active: false });
      expect(handle.snapshot.stages).toContain('started');
    } finally {
      try { control.close(); } catch { /* already closed */ }
      try { await handle.stop(); } catch { /* already closed */ }
      try { handle.stopKernel(); } catch { /* already closed */ }
      try { handle.releaseLock(); } catch { /* already closed */ }
      await stopRun(handle.parsed.configPath);
    }
  }, 60_000);
});
