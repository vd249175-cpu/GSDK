import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { startRun } from '../../tooling/run/src/lifecycle.mjs';
import { connectRunDaemon } from '../../tooling/run/src/mount.mjs';
import { runScenarioSet, writeScenarioReport } from '../../tooling/run/src/scenario.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const helloCounterDir = join(repoRoot, 'app', 'plugins', 'backend', 'hello-counter');
const studioDir = join(repoRoot, 'app', 'plugins', 'backend', 'graphvideo.studio');
const daemonExe = process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon';
const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const STUDIO_LOCALS = [
  'src-fs-source', 'node-md-source', 'node-md-parser', 'node-outliner', 'n-hist',
  'node-sqlite', 'sink-sqlite-writer', 'src-sqlite-observer', 'node-sec-gate',
  'node-generation-model-resolver', 'node-generation-task', 'sink-generation-submit',
  'src-generation-poll', 'src-generation-poll-scheduler', 'sink-generation-download',
  'node-application-lifecycle', 'host-el', 'sink-electron-window', 'src-electron-window',
];
const studioId = (local) => `studio/${local}`;
const STUDIO_INSTANCES = STUDIO_LOCALS.map(studioId);

function writeRun(root, name, document) {
  const directory = join(root, name);
  mkdirSync(join(directory, '.generated', 'runtime'), { recursive: true });
  const configPath = join(directory, 'run.config.json');
  writeFileSync(configPath, JSON.stringify(document, null, 2));
  return configPath;
}

async function startSlice(configPath) {
  const handle = await startRun(configPath);
  return { handle };
}

async function stopSlice(slice) {
  await slice.handle.stop();
}

describe('P7 three-run drill: studio plus two agent runs', () => {
  it('runs the full Studio graph and two counter slices in parallel without sharing endpoints, state or records', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p7-drill-'));
    temporaryRoots.push(root);
    const daemonPath = join(repoRoot, 'packages', 'rust', 'target', 'debug', daemonExe);
    const studioConfig = writeRun(root, 'studio', {
      version: 2, name: 'studio',
      plugins: { backend: [{ id: 'graphvideo.studio', path: studioDir }], frontend: [] },
      kernel: { bind: '127.0.0.1:0', daemonPath },
      backend: { dependencies: {} }, frontend: { instances: [] },
      graph: {
        instances: [
          { kind: 'graph', id: 'studio', factory: { plugin: 'graphvideo.studio', name: 'createStudioNodes' } },
        ],
      },
      lifecycle: {
        initInfos: [],
        startInfos: [
          { targetNodeId: 'studio/node-application-lifecycle', info: { type: 'SystemStartRequestedInfo', requestId: 'p7-studio-1' } },
        ],
        stopInfos: [],
      },
      scenarios: [{
        name: 'studio-ready',
        inputs: [],
        assertions: [{ nodeId: 'studio/node-application-lifecycle', state: { phase: 'Ready' } }],
      }],
      resources: {},
    });
    const aliceConfig = writeRun(root, 'alice', {
      version: 2, name: 'alice',
      plugins: { backend: [{ id: 'example.hello-counter', path: helloCounterDir }], frontend: [] },
      kernel: { bind: '127.0.0.1:0', daemonPath },
      backend: { dependencies: {} }, frontend: { instances: [] },
      graph: { instances: [{ kind: 'node', id: 'example.counter', factory: { plugin: 'example.hello-counter', name: 'createCounterNode' } }] },
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
      version: 2, name: 'task-42',
      plugins: { backend: [{ id: 'example.hello-counter', path: helloCounterDir }], frontend: [] },
      kernel: { bind: '127.0.0.1:0', daemonPath },
      backend: { dependencies: {} }, frontend: { instances: [] },
      graph: { instances: [{ kind: 'node', id: 'example.counter', factory: { plugin: 'example.hello-counter', name: 'createCounterNode' } }] },
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

    const studio = await startSlice(studioConfig);
    const alice = await startSlice(aliceConfig);
    const task = await startSlice(taskConfig);
    const connectSlice = async (slice) => connectRunDaemon({
      address: slice.handle.snapshot.kernel.address,
      token: readFileSync(join(slice.handle.parsed.resources.runtimeDirectory, 'daemon-token'), 'utf8'),
    });
    const studioControl = await connectSlice(studio);
    const aliceControl = await connectSlice(alice);
    const taskControl = await connectSlice(task);
    try {
      expect(new Set([
        studio.handle.snapshot.kernel.address,
        alice.handle.snapshot.kernel.address,
        task.handle.snapshot.kernel.address,
      ]).size).toBe(3);

      // startRun already settled init/start through the barrier; scenarios
      // run against the live supervised slices via fresh control clients.
      for (const [slice, control] of [[studio, studioControl], [alice, aliceControl], [task, taskControl]]) {
        const report = await runScenarioSet({
          parsed: slice.handle.parsed,
          runName: slice.handle.snapshot.runName,
          submitInfos: async (targetNodeId, info, submissionId) => control.inject(targetNodeId, info, submissionId),
          readProjection: async () => control.projection(),
        });
        expect(report.failed).toBe(0);
        writeScenarioReport(slice.handle.parsed.resources.logsDirectory, slice.handle.snapshot.runName, report);
      }

      const [aliceProjection, taskProjection, studioProjection] = await Promise.all([
        aliceControl.projection(), taskControl.projection(), studioControl.projection(),
      ]);
      expect(aliceProjection.nodes['example.counter'].state).toMatchObject({ count: 1 });
      expect(taskProjection.nodes['example.counter'].state).toMatchObject({ count: 2 });
      expect(studioProjection.nodes['studio/node-application-lifecycle'].state.phase).toBe('Ready');

      await stopSlice(alice);
      expect(readFileSync(join(task.handle.parsed.resources.runtimeDirectory, 'daemon-token'), 'utf8').length).toBeGreaterThan(0);
      const stillThere = await taskControl.projection();
      expect(stillThere.nodes['example.counter'].state).toMatchObject({ count: 2 });
      alice.stopped = true;
    } finally {
      for (const control of [studioControl, aliceControl, taskControl]) {
        try { control.close(); } catch { /* already closed */ }
      }
      await stopSlice(studio).catch(() => undefined);
      await stopSlice(task).catch(() => undefined);
      if (!alice.stopped) await stopSlice(alice).catch(() => undefined);
    }
  }, 120_000);
});
