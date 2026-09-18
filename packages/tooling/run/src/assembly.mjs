import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Loads split backend plugin modules and constructs exactly the Nodes named
 * by graph.instances. Every instance declares {kind, id, factory, params,
 * bindings}: kind node mounts one Node ID, kind graph mounts a whole
 * namespaced product under the instance namespace.
 *
 * - instance.factory {plugin, name}: call the backend plugin's named factory
 *   (default-export property or module named export) with a per-instance
 *   context {pluginId, dependencies, instanceId, nodeId, params, bindings,
 *   nodeIdFor}. Factories with describe() produce a namespaced product: every
 *   Node ID starts with `<instanceId>/` and matches localIds exactly.
 * - No createNodes fallback: whole-plugin assembly is refused. Slices never
 *   assemble the whole graph first.
 *
 * Same-ID products are shared mounts, not conflicts: factories may produce
 * overlapping IDs, and the assembly mounts each ID once (first wins, the
 * remainder are disposed). Factories that need isolation namespace via
 * ctx.nodeIdFor(localId).
 *
 * Backend factories take {pluginId, dependencies}: dependencies carry
 * host-injected EffectAdapters and paths, never business State. Callers pass
 * the run's own adapters; Studio daemon runs use in-memory/file ports scoped
 * to the run's data directory, never Electron IPC.
 */
export async function loadRunNodes(parsed, dependencies = {}) {
  const backends = new Map();
  const modules = new Map();
  const backendPlugins = parsed.plugins.backend ?? parsed.plugins.filter?.(() => true) ?? [];
  for (const plugin of backendPlugins) {
    const raw = JSON.parse(readFileSync(resolve(plugin.directory, 'graphvideo.plugin.json'), 'utf8'));
    if (raw.id !== plugin.id) {
      throw new Error(`Plugin identity mismatch: ${plugin.id} (manifest says ${raw.id})`);
    }
    if (raw.apiVersion !== 2 || raw.kind !== 'backend') {
      throw new Error(`Plugin ${plugin.id} apiVersion must be 2 for run config v2`);
    }
    const entry = raw.contributes?.backend;
    if (typeof entry !== 'string' || !entry) throw new Error(`Plugin has no backend entry: ${plugin.id}`);
    const module = await importBackendEntry(plugin.directory, entry, parsed);
    const backend = module.default;
    if (!backend || backend.id !== plugin.id || typeof backend.createNodes !== 'function') {
      throw new Error(`Invalid backend plugin: ${plugin.id}`);
    }
    backends.set(plugin.id, backend);
    modules.set(plugin.id, module);
  }
  const contextFor = (pluginId, instance) => ({
    pluginId,
    dependencies,
    instanceId: instance.id,
    params: instance.params ?? {},
    bindings: instance.bindings ?? {},
    nodeIdFor: (localId) => {
      if (typeof localId !== 'string' || !localId || /\s/.test(localId)) {
        throw new Error(`Invalid local Node id for instance ${instance.id}: ${JSON.stringify(localId)}`);
      }
      return `${instance.id}/${localId}`;
    },
  });
  const constructed = [];
  const expandedNodeIds = new Set();
  for (const instance of parsed.graph.instances) {
    const nodes = await constructInstance(instance, backends, modules, contextFor);
    for (const node of nodes) expandedNodeIds.add(node?.id);
    constructed.push(...nodes);
  }
  return { backends, nodes: await dedupeNodes(constructed), expandedNodeIds };
}

async function constructInstance(instance, backends, modules, contextFor) {
  const backend = backends.get(instance.factory.plugin);
  if (!backend) {
    throw new Error(`Instance references an undeclared plugin: ${instance.id} -> ${instance.factory.plugin}`);
  }
  const module = modules.get(instance.factory.plugin);
  const factory = backend[instance.factory.name] ?? module?.[instance.factory.name];
  if (typeof factory !== 'function') {
    throw new Error(`Factory ${instance.factory.plugin}/${instance.factory.name} is not exported`);
  }
  const created = await factory(contextFor(instance.factory.plugin, instance));
  const list = Array.isArray(created) ? created : [created];
  return acceptFactoryProduct(instance, list, factory);
}

/** Accepts a factory product as a namespaced graph set (describe) or single node. */
function acceptFactoryProduct(instance, list, factory) {
  const label = `Factory ${instance.factory.plugin}/${instance.factory.name}`;
  if (list.length === 0) throw new Error(`${label} produced an empty set for ${instance.id}`);
  if (instance.kind === 'node') {
    if (list.length !== 1 || list[0]?.id !== instance.id) {
      const produced = list.map((node) => node?.id).join(', ');
      throw new Error(`${label} did not construct ${instance.id} (produced ${produced})`);
    }
    return list;
  }
  if (typeof factory.describe === 'function') {
    const first = JSON.stringify(factory.describe());
    if (JSON.stringify(factory.describe()) !== first) throw new Error(`${label} describe 必须是纯函数`);
    const description = first === undefined ? {} : JSON.parse(first);
    const required = Array.isArray(description?.requiredBindings) ? description.requiredBindings : [];
    for (const name of required) {
      if (typeof instance.bindings?.[name] !== 'string' || !instance.bindings[name]) {
        throw new Error(`${label} missing binding ${name} for ${instance.id}`);
      }
    }
    if (Array.isArray(description?.localIds)) {
      const expected = new Set(description.localIds.map((local) => `${instance.id}/${local}`));
      const actual = list.map((node) => node?.id);
      const missing = [...expected].filter((id) => !actual.includes(id));
      const extra = actual.filter((id) => !expected.has(id));
      if (missing.length > 0 || extra.length > 0 || new Set(actual).size !== actual.length) {
        throw new Error(`${label} product mismatch for ${instance.id}: missing [${missing.join(', ')}] extra [${extra.join(', ')}]`);
      }
    }
    return list;
  }
  const prefix = `${instance.id}/`;
  if (list.length > 0 && list.every((node) => typeof node?.id === 'string' && node.id.startsWith(prefix))) {
    return list;
  }
  const produced = list.map((node) => node?.id).join(', ');
  throw new Error(`${label} did not construct namespace ${instance.id} (produced ${produced})`);
}

/**
 * Mounts each Node ID once. Same-ID products are shared mounts: the first
 * construction wins and the remainder are disposed so no duplicate instance
 * lingers unmounted.
 */
async function dedupeNodes(nodes) {
  const seen = new Set();
  const kept = [];
  const dropped = [];
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id) {
      throw new Error('Run assembly produced a Node without an id');
    }
    if (seen.has(node.id)) {
      dropped.push(node);
      continue;
    }
    seen.add(node.id);
    kept.push(node);
  }
  await Promise.allSettled(dropped.map((node) => node.dispose?.()));
  return kept;
}

/** Plugin backend entries stay package-relative, mirroring application.mjs rules. */
export function resolveEntry(pluginDirectory, entry) {
  if (typeof entry !== 'string' || !entry || isAbsolute(entry)) {
    throw new Error(`Invalid plugin entry: ${JSON.stringify(entry)}`);
  }
  const target = resolve(pluginDirectory, entry);
  const rel = relative(pluginDirectory, target);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Plugin entry escapes its plugin: ${entry}`);
  return target;
}

/**
 * Imports a backend entry, building TypeScript entries into the run's own
 * generated dir (never beside plugin sources). Plain .mjs entries import
 * directly. Build output is per-run, so parallel runs never share bundles.
 */
async function importBackendEntry(pluginDirectory, entry, parsed) {
  const target = resolveEntry(pluginDirectory, entry);
  if (target.endsWith('.mjs') || target.endsWith('.js')) {
    return import(pathToFileURL(target).href);
  }
  const { build } = await loadEsbuild();
  const { runBackendOutfile, defaultGeneratedLayout } = await import('./paths.mjs');
  const layout = defaultGeneratedLayout(parsed.baseDirectory);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(layout.backend, { recursive: true });
  const outfile = runBackendOutfile(layout, parsed.runName ?? 'run', entry);
  const { fileURLToPath } = await import('node:url');
  const sdkSrc = fileURLToPath(new URL('../../../sdk/javascript/src/', import.meta.url));
  const desktopDir = fileURLToPath(new URL('../../../desktop/', import.meta.url));
  const { resolve: resolvePath } = await import('node:path');
  const alias = Object.fromEntries(['protocol', 'node', 'effect', 'plugin', 'analysis', 'agent', 'testing'].map((name) => [
    '@graphvideo/sdk/' + name, resolvePath(sdkSrc, name, 'index.ts'),
  ]));
  alias.yaml = resolvePath(desktopDir, 'node_modules', 'yaml', 'browser', 'index.js');
  await build({
    entryPoints: [target],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias,
    external: ['*.node', 'typescript', 'electron', '@graphvideo/desktop/*'],
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

async function loadEsbuild() {
  try {
    return await import('esbuild');
  } catch { /* fall through to vendored copies */ }
  const { createRequire } = await import('node:module');
  for (const anchor of [import.meta.url, new URL('../../../desktop/package.json', import.meta.url).href]) {
    try {
      return createRequire(anchor)('esbuild');
    } catch { /* try next anchor */ }
  }
  throw new Error("Cannot find package 'esbuild' for run backend builds");
}
