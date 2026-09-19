import { cleanupRunFixtures } from './test-run-cleanup.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRunNodes } from '../../tooling/run/src/assembly.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const helloCounterDir = join(repoRoot, 'app', 'plugins', 'backend', 'hello-counter');
const helloCounterFileUrl = pathToFileURL(join(helloCounterDir, 'index.mjs')).href;
const daemonExe = process.platform === 'win32' ? 'graphframework-kernel-daemon.exe' : 'graphframework-kernel-daemon';
const temporaryRoots = [];
afterEach(() => cleanupRunFixtures(temporaryRoots));

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
  writeFileSync(join(directory, 'graphframework.plugin.json'), JSON.stringify({
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
export default { id: 'example.agent', rendererRoots: [{ targetNodeId: 'counter', infoType: 'IncrementInfo', validate: (info) => info.type === 'IncrementInfo' }] };
`);
}

describe('P8 factory instances: explicit IDs, bindings and namespace isolation', () => {
  it.each(['undeclared', 'kind', 'binding'])('rejects %s factory contracts before constructing Nodes', async (failure) => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p8-contract-'));
    temporaryRoots.push(root);
    const directory = join(root, 'plugin'); mkdirSync(directory);
    writeFileSync(join(directory, 'graphframework.plugin.json'), JSON.stringify({
      id: 'example.contract', name: 'Contract', version: '1.0.0', apiVersion: 2, kind: 'backend',
      contributes: { backend: 'index.mjs', graphFactories: failure === 'undeclared' ? [] : ['createGraph'] },
    }));
    writeFileSync(join(directory, 'index.mjs'), `
export function createGraph() { throw new Error('construction must not occur'); }
createGraph.describe = () => ({ kind: ${JSON.stringify(failure === 'kind' ? 'node' : 'graph')}, localIds: ['owner'], requiredBindings: ${JSON.stringify(failure === 'binding' ? ['sink'] : [])}, rendererRoots: [] });
export default { id: 'example.contract' };
`);
    const config = writeRun(root, 'slice', baseDocument({ plugins: { backend: [{ id: 'example.contract', path: directory }], frontend: [] }, graph: { instances: [{ kind: 'graph', id: 'agent', factory: { plugin: 'example.contract', name: 'createGraph' } }] } }));
    const { loadRunConfig } = await import('../../tooling/run/src/session.mjs');
    await expect(loadRunNodes(loadRunConfig(config))).rejects.toThrow(failure === 'undeclared' ? 'is not exported' : failure === 'kind' ? 'kind mismatch' : 'missing binding sink');
  });

  it('rejects duplicate instance IDs instead of silently sharing an Owner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p8-dedupe-'));
    temporaryRoots.push(root);
    const { loadRunConfig } = await import('../../tooling/run/src/lifecycle.mjs');
    const configPath = writeRun(root, 'alice', baseDocument({
      name: 'alice',
      plugins: { backend: [{ id: 'example.hello-counter', path: helloCounterDir }], frontend: [] },
      graph: { instances: [{ kind: 'node', id: 'example.counter', factory: { plugin: 'example.hello-counter', name: 'createCounterNode' } }, { kind: 'node', id: 'example.counter', factory: { plugin: 'example.hello-counter', name: 'createCounterNode' } }] },
    }));
    expect(() => loadRunConfig(configPath)).toThrow('duplicate graph instance');
  });

  it('injects a standalone Node ID and explicit targets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p8-node-'));
    temporaryRoots.push(root);
    const pluginDir = join(root, 'custom-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'graphframework.plugin.json'), JSON.stringify({
      id: 'example.custom', name: 'Custom', version: '1.0.0', apiVersion: 2, kind: 'backend',
      contributes: { backend: 'backend.mjs', nodeFactories: ['createCustomNode'], graphFactories: [] },
    }, null, 2));
    writeFileSync(join(pluginDir, 'backend.mjs'), `
      export function createCustomNode(ctx) {
        return {
          id: ctx.instanceId,
          targets: ctx.bindings ?? {},
          dispose: async () => {},
        };
      }
      export default {
        id: 'example.custom',
        createCustomNode,
      };
    `);
    const { loadRunConfig } = await import('../../tooling/run/src/lifecycle.mjs');
    const configPath = writeRun(root, 'slice', baseDocument({
      plugins: { backend: [{ id: 'example.custom', path: pluginDir }], frontend: [] },
      graph: { instances: [{ kind: 'node', id: 'custom-document', factory: { plugin: 'example.custom', name: 'createCustomNode' }, bindings: { parser: 'collector', registry: 'persistence/registry' } }] },
    }));
    const { nodes } = await loadRunNodes(loadRunConfig(configPath));
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('custom-document');
    expect(nodes[0].targets).toMatchObject({ parser: 'collector', registry: 'persistence/registry' });
    await nodes[0].dispose();
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
    const { connectRunDaemon } = await import('../../tooling/run/src/mount.mjs');
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
    // startRun owns the supervised slice; the pair shares one daemon.
    const handle = await startRun(configPath);
    const control = await connectRunDaemon({
      address: handle.snapshot.kernel.address,
      token: readFileSync(join(handle.parsed.resources.runtimeDirectory, 'daemon-token'), 'utf8'),
    });
    try {
      const projection = await control.projection();
      expect(Object.keys(projection.nodes).sort()).toEqual(['agent-a/counter', 'agent-b/counter']);

      const health = await control.analyze({ op: 'health' });
      expect(health.nodeCount).toBe(2);

      const { callRunControl } = await import('../../tooling/run/src/control.mjs');
      const hostHealth = await callRunControl(handle.parsed.resources.runtimeDirectory, 'analyze', { request: { op: 'health' } });
      expect(hostHealth.nodeCount).toBe(2);

      const hostInspect = await callRunControl(handle.parsed.resources.runtimeDirectory, 'inspect', { limit: 10 });
      expect(hostInspect.projection.nodes['agent-a/counter']).toBeDefined();
    } finally {
      try { control.close(); } catch { /* already closed */ }
      try { await handle.stop(); } catch { /* already closed */ }
      try { handle.stopKernel(); } catch { /* already closed */ }
      try { handle.releaseLock(); } catch { /* already closed */ }
      await stopRun(handle.parsed.configPath);
    }
  }, 60_000);
});
