import { cleanupRunFixtures } from './test-run-cleanup.mjs';
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
afterEach(() => cleanupRunFixtures(temporaryRoots));

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

  it.each([false, true])('runs and closes the configured scenario, failure=%s', async (failure) => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p5-run-'));
    temporaryRoots.push(root);
    const configPath = writeRun(root, 'alice', {
      lifecycle: {
        initInfos: [{ targetNodeId: 'example.counter', info: { type: 'IncrementInfo' } }],
        startInfos: [{ targetNodeId: 'example.counter', info: { type: 'IncrementInfo' } }],
        stopInfos: [],
      },
      scenarios: [{
        name: 'counter-after-start', inputs: [{ targetNodeId: 'example.counter', info: { type: 'IncrementInfo' } }],
        assertions: [
          { nodeId: 'example.counter', state: { count: failure ? 99 : 3 }, version: 3 },
          { submission: 'alice/scenario/counter-after-start/1', status: 'completed' },
        ],
      }],
    });
    if (failure) await expect(startRun(configPath)).rejects.toMatchObject({ code: 1 });
    else {
      const handle = await startRun(configPath);
      expect(handle.snapshot).toMatchObject({ stopped: true, report: { passed: 1, failed: 0 } });
    }
    const runtime = join(dirname(configPath), '.generated/runtime');
    const snapshot = JSON.parse(readFileSync(join(runtime, 'config-snapshot.json'), 'utf8'));
    expect(snapshot.state).toBe('closed');
    expect(snapshot.scenarioReport.failed).toBe(failure ? 1 : 0);
    if (failure) expect(snapshot.scenarioReport.scenarios[0].error).toContain('count');
    expect(JSON.parse(readFileSync(join(runtime, 'close-result.json'), 'utf8')).exitCode).toBe(failure ? 1 : 0);
  }, 60_000);
});
