import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRunNodes } from '../../tooling/run/src/assembly.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const helloCounterDir = join(repoRoot, 'app', 'plugins', 'backend', 'hello-counter');
const helloCounterFileUrl = pathToFileURL(join(helloCounterDir, 'index.mjs')).href;
const daemonExe = process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon';
const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeRun(root, name, document) {
  const directory = join(root, name);
  mkdirSync(join(directory, '.generated', 'runtime'), { recursive: true });
  const configPath = join(directory, 'run.config.json');
  writeFileSync(configPath, JSON.stringify(document, null, 2));
  return configPath;
}

function baseDocument(overrides = {}) {
  return {
    version: 2,
    kernel: { bind: '127.0.0.1:0', daemonPath: join(repoRoot, 'packages', 'rust', 'target', 'debug', daemonExe) },
    backend: { dependencies: {} }, frontend: { instances: [] },
    lifecycle: { initInfos: [], startInfos: [], stopInfos: [] },
    resources: {},
    ...overrides,
  };
}

function writeAgentFixturePlugin(directory, { realNodes }) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'graphvideo.plugin.json'), JSON.stringify({
    id: 'example.agent', name: 'Agent', version: '1.0.0', apiVersion: 2, kind: 'backend',
    contributes: { backend: 'backend.mjs', nodeFactories: [], graphFactories: ['createAgentGraph'] },
  }, null, 2));
  const body = realNodes
    ? `
import { CounterNode } from ${JSON.stringify(helloCounterFileUrl)};
export function createAgentGraph(ctx) {
  if (typeof ctx?.nodeIdFor !== 'function') throw new Error('GraphFactory context requires nodeIdFor(localId)');
  if (!ctx?.instanceId) throw new Error('GraphFactory context requires instanceId');
  return [new CounterNode(ctx.nodeIdFor('counter'))];
}
`
    : `
export function createAgentGraph(ctx) {
  if (typeof ctx?.nodeIdFor !== 'function') throw new Error('GraphFactory context requires nodeIdFor(localId)');
  if (!ctx?.instanceId) throw new Error('GraphFactory context requires instanceId');
  const id = ctx.nodeIdFor('counter');
  return [{ id, getState: () => ({ count: 0 }), dispose: async () => {} }];
}
`;
  writeFileSync(join(directory, 'backend.mjs'), `${body}
createAgentGraph.describe = () => ({
  kind: 'graph',
  localIds: ['counter'],
  requiredBindings: [],
  rendererRoots: [{ localId: 'counter', infoType: 'IncrementInfo' }],
});
export default { id: 'example.agent', createNodes: () => [] };
`);
}

describe('P8 factory instances: same-ID dedupe plus namespaced isolation', () => {
  it('dedupes identical Node IDs instead of throwing Duplicate', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p8-dedupe-'));
    temporaryRoots.push(root);
    const { loadRunConfig } = await import('../../tooling/run/src/lifecycle.mjs');
    const configPath = writeRun(root, 'alice', baseDocument({
      name: 'alice',
      plugins: { backend: [{ id: 'example.hello-counter', path: helloCounterDir }], frontend: [] },
      graph: { instances: [{ kind: 'node', id: 'example.counter', factory: { plugin: 'example.hello-counter', name: 'createCounterNode' } }, { kind: 'node', id: 'example.counter', factory: { plugin: 'example.hello-counter', name: 'createCounterNode' } }] },
    }));
    const parsed = loadRunConfig(configPath);
    const { nodes } = await loadRunNodes(parsed);
    expect(nodes.map((n) => n.id)).toEqual(['example.counter']);
  });

  it('assembles two isolated instances from the same graph factory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p8-isolated-'));
    temporaryRoots.push(root);
    const pluginDir = join(root, 'agent-plugin');
    writeAgentFixturePlugin(pluginDir, { realNodes: false });
    const { loadRunConfig } = await import('../../tooling/run/src/lifecycle.mjs');
    const configPath = writeRun(root, 'team', baseDocument({
      name: 'team',
      plugins: { backend: [{ id: 'example.agent', path: pluginDir }], frontend: [] },
      graph: { instances: [
        { kind: 'graph', id: 'agent-a', factory: { plugin: 'example.agent', name: 'createAgentGraph' } },
        { kind: 'graph', id: 'agent-b', factory: { plugin: 'example.agent', name: 'createAgentGraph' } },
      ] },
    }));
    const parsed = loadRunConfig(configPath);
    const { nodes } = await loadRunNodes(parsed);
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['agent-a/counter', 'agent-b/counter']);
  });

  it('mounts two agent instances from one factory in one run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p8-pair-'));
    temporaryRoots.push(root);
    const pluginDir = join(root, 'agent-plugin');
    writeAgentFixturePlugin(pluginDir, { realNodes: true });
    const { loadRunConfig } = await import('../../tooling/run/src/lifecycle.mjs');
    const { connectRunDaemon, mountRunSlice, unmountRunSlice } = await import('../../tooling/run/src/mount.mjs');
    const { startRun, stopRun } = await import('../../tooling/run/src/lifecycle.mjs');
    const { readFileSync } = await import('node:fs');
    const configPath = writeRun(root, 'pair', baseDocument({
      name: 'pair',
      plugins: { backend: [{ id: 'example.agent', path: pluginDir }], frontend: [] },
      graph: { instances: [
        { kind: 'graph', id: 'agent-a', factory: { plugin: 'example.agent', name: 'createAgentGraph' } },
        { kind: 'graph', id: 'agent-b', factory: { plugin: 'example.agent', name: 'createAgentGraph' } },
      ] },
    }));
    const handle = await startRun(configPath);
    const credential = readFileSync(join(handle.parsed.resources.runtimeDirectory, 'daemon-token'), 'utf8');
    const control = await connectRunDaemon({ address: handle.snapshot.kernel.address, token: credential });
    const worker = await connectRunDaemon({ address: handle.snapshot.kernel.address, token: credential });
    const workerStop = new AbortController();
    const watchdog = setTimeout(() => workerStop.abort(), 25_000);
    try {
      const { nodes } = await loadRunNodes(handle.parsed);
      const mount = await mountRunSlice({ nodes, control, worker, signal: workerStop.signal });
      const projection = await control.projection();
      expect(Object.keys(projection.nodes).sort()).toEqual(['agent-a/counter', 'agent-b/counter']);
      await unmountRunSlice({
        control, workerStop, running: mount.running, admitted: mount.admitted, assemblies: mount.assemblies,
      });
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
