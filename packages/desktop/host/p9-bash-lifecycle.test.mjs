import { cleanupRunFixtures } from './test-run-cleanup.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { statusRun } from '../../tooling/run/src/lifecycle.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const daemonExe = process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon';
const temporaryRoots = [];
afterEach(() => cleanupRunFixtures(temporaryRoots));

function writeRun(root, name, overrides = {}) {
  const directory = join(root, name);
  mkdirSync(join(directory, '.generated', 'runtime'), { recursive: true });
  const payload = {
    version: 2,
    name,
    plugins: { backend: [], frontend: [] },
    kernel: { bind: '127.0.0.1:0', daemonPath: join(repoRoot, 'packages', 'rust', 'target', 'debug', daemonExe) },
    backend: { dependencies: {} },
    frontend: { instances: [] },
    graph: { instances: [] },
    lifecycle: { initInfos: [], startInfos: [], stopInfos: [] },
    resources: {},
    ...overrides,
  };
  const configPath = join(directory, 'run.config.json');
  writeFileSync(configPath, JSON.stringify(payload, null, 2));
  return configPath;
}

function sh(op, configPath) {
  let out;
  const bash = process.env.GRAPHVIDEO_BASH ?? (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
  try { out = execFileSync(bash, ['./run.sh', op, configPath], {
    cwd: repoRoot, timeout: 90_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }); } catch (error) {
    const log = join(dirname(configPath), '.generated/logs/supervisor.log');
    throw new Error(`${error.message}\n${existsSync(log) ? readFileSync(log, 'utf8') : ''}`, { cause: error });
  }
  return JSON.parse(out);
}

describe('P9 bash symmetric lifecycle', () => {
  it('keeps the run active after start and closes it on stop', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p9-lifecycle-'));
    temporaryRoots.push(root);
    const configPath = writeRun(root, 'alice');
    const started = sh('start', configPath);
    expect(started.started).toBe(true);
    expect(started.stages).toContain('started');
    try {
      const active = statusRun(configPath);
      expect(active).toMatchObject({ active: true, runName: 'alice' });
      expect(active.stages).toContain('started');
      expect(active.kernel.address).toBe(started.kernel.address);

      const health = sh('analyze', configPath);
      expect(health).toHaveProperty('nodeCount');

      const inspect = sh('inspect', configPath);
      expect(inspect).toHaveProperty('projection');

      const stopped = sh('stop', configPath);
      expect(stopped).toMatchObject({ stopped: true, already: false });
      const closed = statusRun(configPath);
      expect(closed).toMatchObject({ active: false });
      expect(closed.stages).toContain('closed');
      // Kernel port is gone: the detached stop shut the daemon down.
      expect(closed.stages).toEqual([
        'validate', 'lock', 'kernel-ready', 'hosts-ready',
        'assembled', 'admitted', 'workers-ready', 'initialized', 'started',
        'stopping', 'settled', 'evicted', 'kernel-stopped', 'hosts-stopped', 'closed',
      ]);
      expect(sh('stop', configPath)).toMatchObject({ stopped: true, already: true });
    } finally {
      try { sh('stop', configPath); } catch { /* already closed */ }
    }
  }, 120_000);

  function resourceRun(root, { scenario = false, failDispose = false } = {}) {
    const plugin = join(root, 'plugin');
    const marker = join(root, 'disposed.json');
    const failure = join(root, 'fail-dispose');
    mkdirSync(plugin);
    if (failDispose) writeFileSync(failure, 'fail');
    writeFileSync(join(plugin, 'graphvideo.plugin.json'), JSON.stringify({ id: 'fixture.cleanup', name: 'Fixture', version: '1.0.0', apiVersion: 2, kind: 'backend', contributes: { backend: 'index.mjs', nodeFactories: ['createResource'] } }));
    writeFileSync(join(plugin, 'index.mjs'), `
import { existsSync, writeFileSync } from 'node:fs';
export function createResource(ctx) {
  const seen = [];
  let disposed = false;
  return { id: ctx.nodeId, getState: () => ({ count: 0 }),
    change(info, change) { seen.push(info.type); if (info.type === 'IncrementInfo') change.write('count', change.read('count') + 1); },
    async dispose() { if (disposed) return; if (existsSync(${JSON.stringify(failure)})) throw new Error('fixture disposal failed'); writeFileSync(${JSON.stringify(marker)}, JSON.stringify(seen)); disposed = true; }
  };
}
export default { id: 'fixture.cleanup', createNodes: () => [] };
`);
    const config = writeRun(root, 'resource', {
      plugins: { backend: [{ id: 'fixture.cleanup', path: plugin }], frontend: [] },
      graph: { instances: [{ kind: 'node', id: 'resource-node', factory: { plugin: 'fixture.cleanup', name: 'createResource' } }] },
      lifecycle: { initInfos: [], startInfos: [], stopInfos: [{ targetNodeId: 'resource-node', info: { type: 'OriginalStopInfo' } }] },
      ...(scenario ? { scenarios: [{ name: 'increment', inputs: [{ targetNodeId: 'resource-node', info: { type: 'IncrementInfo' } }], assertions: [{ nodeId: 'resource-node', state: { count: 1 } }] }] } : {}),
    });
    return { config, marker, failure };
  }
  it('stops a real slice using its immutable snapshot and confirms local disposal', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p9-resource-')); temporaryRoots.push(root);
    const { config, marker } = resourceRun(root);
    sh('start', config);
    rmSync(config);
    expect(sh('stop', config).stopped).toBe(true);
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual(['OriginalStopInfo']);
  }, 120_000);
  it('retains failed cleanup and permits a verified retry', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p9-retry-')); temporaryRoots.push(root);
    const { config, marker, failure } = resourceRun(root, { failDispose: true });
    sh('start', config);
    try {
      expect(() => sh('stop', config)).toThrow();
      expect(statusRun(config)).toMatchObject({ active: true, state: 'stop-failed', lastError: expect.stringContaining('fixture disposal failed') });
      expect(existsSync(marker)).toBe(false);
      rmSync(failure);
      expect(sh('stop', config).stopped).toBe(true);
      expect(existsSync(marker)).toBe(true);
    } finally { rmSync(failure, { force: true }); sh('stop', config); }
  }, 120_000);
  it('runs configured scenarios through the same root entry and closes before returning', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p9-scene-')); temporaryRoots.push(root);
    const { config, marker } = resourceRun(root, { scenario: true });
    const result = sh('start', config);
    expect(result).toMatchObject({ started: true, stopped: true, exitCode: 0, report: { passed: 1, failed: 0 } });
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual(['IncrementInfo', 'OriginalStopInfo']);
    expect(statusRun(config).active).toBe(false);
  }, 120_000);
  it('preserves a failed scenario exit status after successful cleanup', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p9-scene-failed-')); temporaryRoots.push(root);
    const { config, marker } = resourceRun(root, { scenario: true });
    const definition = JSON.parse(readFileSync(config, 'utf8')); definition.scenarios[0].assertions[0].state.count = 2;
    writeFileSync(config, JSON.stringify(definition));
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
    let failure;
    try { execFileSync(bash, ['./run.sh', 'start', config], { cwd: repoRoot, encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { failure = error; }
    expect(failure.status).toBe(1);
    expect(JSON.parse(failure.stdout)).toMatchObject({ stopped: true, exitCode: 1, report: { failed: 1, passed: 0 } });
    expect(existsSync(marker)).toBe(true);
    expect(statusRun(config).active).toBe(false);
  }, 120_000);
});
