import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRunNodes } from '../../tooling/run/src/assembly.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const helloCounterDir = join(repoRoot, 'app', 'plugins', 'hello-counter');
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
    version: 1,
    kernel: { bind: '127.0.0.1:0', daemonPath: join(repoRoot, 'packages', 'rust', 'target', 'debug', daemonExe) },
    backend: {}, frontend: { enabled: false },
    lifecycle: { initInfos: [], startInfos: [], stopInfos: [] },
    resources: {},
    ...overrides,
  };
}

function writeAgentFixturePlugin(directory) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'graphvideo.plugin.json'), JSON.stringify({
    id: 'example.agent', name: 'Agent', version: '1.0.0', apiVersion: 1,
    contributes: { backend: 'backend.mjs', elements: [], workspaces: [] },
  }, null, 2));
  // Plain-object Nodes on purpose: the fixture lives in a tmp dir outside the
  // repo, so bare `@graphvideo/sdk/*` imports would not resolve here. The run
  // assembly only needs structural `{ id, dispose? }` products.
  writeFileSync(join(directory, 'backend.mjs'), `
export function createAgentGraph(ctx) {
  if (typeof ctx?.nodeIdFor !== 'function') throw new Error('GraphFactory context requires nodeIdFor(localId)');
  if (!ctx?.instanceId) throw new Error('GraphFactory context requires instanceId');
  const id = ctx.nodeIdFor('counter');
  return [{ id, getState: () => ({ count: 0 }), dispose: async () => {} }];
}
createAgentGraph.describe = () => ({
  kind: 'graph',
  localIds: ['counter'],
  requiredBindings: [],
  rendererRoots: [{ localId: 'counter', infoType: 'IncrementInfo' }],
});
export default { id: 'example.agent', createNodes: () => [], createAgentGraph };
`);
}

describe('P8 factory instances: same-ID dedupe plus namespaced isolation', () => {
  it('dedupes identical Node IDs instead of throwing Duplicate', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p8-dedupe-'));
    temporaryRoots.push(root);
    const { loadRunConfig } = await import('../../tooling/run/src/lifecycle.mjs');
    const configPath = writeRun(root, 'alice', baseDocument({
      name: 'alice',
      plugins: [{ id: 'example.hello-counter', path: helloCounterDir }],
      graph: { instances: [{ nodeId: 'example.counter' }, { nodeId: 'example.counter' }] },
    }));
    const parsed = loadRunConfig(configPath);
    const { nodes } = await loadRunNodes(parsed);
    expect(nodes.map((n) => n.id)).toEqual(['example.counter']);
  });

  it('assembles two isolated instances from the same graph factory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p8-isolated-'));
    temporaryRoots.push(root);
    const pluginDir = join(root, 'agent-plugin');
    writeAgentFixturePlugin(pluginDir);
    const { loadRunConfig } = await import('../../tooling/run/src/lifecycle.mjs');
    const configPath = writeRun(root, 'team', baseDocument({
      name: 'team',
      plugins: [{ id: 'example.agent', path: pluginDir }],
      graph: { instances: [
        { nodeId: 'agent-a', factory: { plugin: 'example.agent', name: 'createAgentGraph' } },
        { nodeId: 'agent-b', factory: { plugin: 'example.agent', name: 'createAgentGraph' } },
      ] },
    }));
    const parsed = loadRunConfig(configPath);
    const { nodes } = await loadRunNodes(parsed);
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['agent-a/counter', 'agent-b/counter']);
  });
});
