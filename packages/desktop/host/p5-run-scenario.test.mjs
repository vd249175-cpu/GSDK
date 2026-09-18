import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRunConfig } from '../../tooling/run/src/config.mjs';
import { loadRunNodes } from '../../tooling/run/src/assembly.mjs';
import { loadRunConfig, startRun, stopRun } from '../../tooling/run/src/lifecycle.mjs';
import { connectRunDaemon, injectLifecycleInfos, mountRunSlice, unmountRunSlice } from '../../tooling/run/src/mount.mjs';
import { runScenarioSet, writeScenarioReport } from '../../tooling/run/src/scenario.mjs';
import { resolveRunRoot } from '../../tooling/run/src/paths.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const helloCounterDir = join(repoRoot, 'app', 'plugins', 'backend', 'hello-counter');
const daemonExe = process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon';
const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeRun(root, name, document = {}) {
  const directory = join(root, name);
  mkdirSync(join(directory, '.generated', 'runtime'), { recursive: true });
  const payload = {
    version: 2,
    name,
    plugins: { backend: [{ id: 'example.hello-counter', path: helloCounterDir }], frontend: [] },
    kernel: { bind: '127.0.0.1:0', daemonPath: join(repoRoot, 'packages', 'rust', 'target', 'debug', daemonExe) },
    backend: { dependencies: {} },
    frontend: { instances: [] },
    graph: { instances: [{ kind: 'node', id: 'example.counter', factory: { plugin: 'example.hello-counter', name: 'createCounterNode' } }] },
    lifecycle: { initInfos: [], startInfos: [], stopInfos: [] },
    scenarios: null,
    resources: {},
    ...document,
  };
  const configPath = join(directory, 'run.config.json');
  writeFileSync(configPath, JSON.stringify(payload, null, 2));
  return configPath;
}

async function startSlice(configPath) {
  const handle = await startRun(configPath);
  return { handle };
}

async function stopSlice(slice) {
  await slice.handle.stop();
}

describe('P5 same-run scenarios on the real daemon', () => {
  it('rejects scenario input that no assembled instance can receive', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p5-contract-'));
    temporaryRoots.push(root);
    expect(() => {
      const configPath = writeRun(root, 'alice', {
        scenarios: [{
          name: 'missing-target',
          inputs: [{ targetNodeId: 'example.ghost', info: { type: 'IncrementInfo' } }],
          assertions: [],
        }],
      });
      const absolute = resolve(configPath);
      parseRunConfig(JSON.parse(readFileSync(absolute, 'utf8')), {
        configPath: absolute, baseDirectory: resolveRunRoot(absolute),
      });
    }).toThrow('unassembled instance');
  });

  it('mounts exactly the declared factory product', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p5-slice-'));
    temporaryRoots.push(root);
    const configPath = writeRun(root, 'alice', {
      graph: { instances: [{ kind: 'node', id: 'example.counter', factory: { plugin: 'example.hello-counter', name: 'createCounterNode' } }] },
    });
    const parsed = loadRunConfig(configPath);
    const { nodes } = await loadRunNodes(parsed);
    expect(nodes.map((node) => node.id)).toEqual(['example.counter']);
  });

  it('mounts the real slice, settles init then start, and asserts the projection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p5-run-'));
    temporaryRoots.push(root);
    const configPath = writeRun(root, 'alice', {
      lifecycle: {
        initInfos: [{ targetNodeId: 'example.counter', info: { type: 'IncrementInfo' } }],
        startInfos: [{ targetNodeId: 'example.counter', info: { type: 'IncrementInfo' } }],
        stopInfos: [],
      },
      scenarios: [{
        name: 'counter-reaches-two',
        inputs: [],
        assertions: [
          { nodeId: 'example.counter', state: { count: 2 }, version: 2 },
          { submission: 'alice/init/1', status: 'completed' },
          { submission: 'alice/start/1', status: 'completed' },
        ],
      }],
    });
    const slice = await startSlice(configPath);
    const control = await connectRunDaemon({
      address: slice.handle.snapshot.kernel.address,
      token: readFileSync(join(slice.handle.parsed.resources.runtimeDirectory, 'daemon-token'), 'utf8'),
    });
    try {
      const runName = slice.handle.snapshot.runName;
      const report = await runScenarioSet({
        parsed: slice.handle.parsed,
        runName,
        submitInfos: async (targetNodeId, info, submissionId) => control.inject(targetNodeId, info, submissionId),
        readProjection: async () => control.projection(),
      });
      expect(report.failed).toBe(0);
      expect(report.scenarios).toHaveLength(1);
      const path = writeScenarioReport(slice.handle.parsed.resources.logsDirectory, runName, report);
      expect(readFileSync(path, 'utf8')).toContain('counter-reaches-two');
      control.close();
    } finally {
      await stopSlice(slice);
    }
  }, 60_000);

  it('keeps the assertion evidence when a scenario fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p5-fail-'));
    temporaryRoots.push(root);
    const configPath = writeRun(root, 'alice', {
      lifecycle: {
        initInfos: [{ targetNodeId: 'example.counter', info: { type: 'IncrementInfo' } }],
        startInfos: [],
        stopInfos: [],
      },
      scenarios: [{
        name: 'wrong-count',
        inputs: [],
        assertions: [{ nodeId: 'example.counter', state: { count: 99 } }],
      }],
    });
    const slice = await startSlice(configPath);
    const control = await connectRunDaemon({
      address: slice.handle.snapshot.kernel.address,
      token: readFileSync(join(slice.handle.parsed.resources.runtimeDirectory, 'daemon-token'), 'utf8'),
    });
    try {
      const runName = slice.handle.snapshot.runName;
      const report = await runScenarioSet({
        parsed: slice.handle.parsed,
        runName,
        submitInfos: async (targetNodeId, info, submissionId) => control.inject(targetNodeId, info, submissionId),
        readProjection: async () => control.projection(),
      });
      expect(report.failed).toBe(1);
      expect(report.scenarios[0].ok).toBe(false);
      expect(report.scenarios[0].error).toContain('count');
      const path = writeScenarioReport(slice.handle.parsed.resources.logsDirectory, runName, report);
      expect(readFileSync(path, 'utf8')).toContain('wrong-count');
      control.close();
    } finally {
      await stopSlice(slice);
    }
  }, 60_000);
});
