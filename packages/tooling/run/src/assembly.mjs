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
 * Config normalization deduplicates repeated declarations before any factory
 * runs. If different factory products still claim one Node ID, assembly reports
 * a definition conflict instead of silently replacing an Owner. Failed
 * assembly disposes all returned products and reports cleanup errors.
 *
 * Backend factories take {pluginId, dependencies}: dependencies carry
 * host-injected EffectAdapters and paths, never business State. Callers pass
 * the run's own adapters; Studio daemon runs use in-memory/file ports scoped
 * to the run's data directory, never Electron IPC.
 */
export async function loadRunNodes(parsed, dependencies = {}) {
  const backends = new Map();
  const modules = new Map();
  const backendPlugins = parsed.plugins.backend;
  for (const plugin of backendPlugins) {
    const raw = JSON.parse(readFileSync(resolve(plugin.directory, 'graphframework.plugin.json'), 'utf8'));
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
    if (!backend || backend.id !== plugin.id) {
      throw new Error(`Invalid backend plugin: ${plugin.id}`);
    }
    backends.set(plugin.id, backend);
    modules.set(plugin.id, module);
    for (const instance of parsed.graph.instances.filter((item) => item.factory.plugin === plugin.id)) {
      const names = raw.contributes?.[instance.kind === 'node' ? 'nodeFactories' : 'graphFactories'] ?? [];
      if (!names.includes(instance.factory.name)) throw new Error(`Factory ${plugin.id}/${instance.factory.name} is not exported in the ${instance.kind} manifest`);
    }
  }
  const contextFor = (pluginId, instance) => ({
    pluginId,
    dependencies: typeof dependencies === 'function' ? dependencies(instance) : dependencies,
    instanceId: instance.id,
    nodeId: instance.id,
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
  const rendererRoots = [];
  const expandedNodeIds = new Set();
  try {
    for (const instance of parsed.graph.instances) {
      const nodes = await constructInstance(instance, backends, modules, contextFor);
      constructed.push(...nodes);
      for (const node of nodes) {
        if (!node || typeof node.id !== 'string' || !node.id) throw new Error('Run assembly produced a Node without an id');
        if (expandedNodeIds.has(node.id)) throw new Error(`Node assembly conflict: multiple factory products claim ${node.id}`);
        expandedNodeIds.add(node.id);
      }
      const backend = backends.get(instance.factory.plugin);
      const factory = backend[instance.factory.name] ?? modules.get(instance.factory.plugin)?.[instance.factory.name];
      const description = factory.describe?.();
      for (const root of description?.rendererRoots ?? []) {
        const targetNodeId = instance.kind === 'node' ? instance.id : `${instance.id}/${root.localId}`;
        if (!nodes.some((node) => node.id === targetNodeId)) throw new Error(`Renderer root outside factory product: ${targetNodeId}`);
        const validator = backend.rendererRoots?.find((candidate) => candidate.infoType === root.infoType);
        if (!validator || typeof validator.validate !== 'function') throw new Error(`Renderer root has no validator: ${targetNodeId} ${root.infoType}`);
        rendererRoots.push({ targetNodeId, infoType: root.infoType, validate: validator.validate });
      }
    }
    return { backends, nodes: constructed, expandedNodeIds, rendererRoots };
  } catch (error) {
    const cleanup = await Promise.allSettled(constructed.map((node) => node?.dispose?.()));
    const failures = cleanup.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError([error, ...failures], 'Run assembly and cleanup failed');
    throw error;
  }
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
  const description = factory.describe?.();
  if (description) {
    if (description.kind !== instance.kind) throw new Error(`Factory kind mismatch for ${instance.id}`);
    for (const name of description.requiredBindings ?? []) {
      if (typeof instance.bindings?.[name] !== 'string' || !instance.bindings[name]) throw new Error(`Factory ${instance.factory.name} missing binding ${name} for ${instance.id}`);
    }
  }
  const created = await factory(contextFor(instance.factory.plugin, instance));
  const list = Array.isArray(created) ? created : [created];
  try {
    return acceptFactoryProduct(instance, list, factory);
  } catch (error) {
    const cleanup = await Promise.allSettled(list.map((node) => node?.dispose?.()));
    const failures = cleanup.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError([error, ...failures], 'Invalid factory product and cleanup failed');
    throw error;
  }
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
const nativeImport = new Function('specifier', 'return import(specifier)');

export async function importBackendEntry(pluginDirectory, entry, parsed) {
  const target = resolveEntry(pluginDirectory, entry);
  if (target.endsWith('.mjs') || target.endsWith('.js')) {
    return nativeImport(pathToFileURL(target).href);
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
    '@graphframework/sdk/' + name, resolvePath(sdkSrc, name, 'index.ts'),
  ]));
  alias.yaml = resolvePath(desktopDir, 'node_modules', 'yaml', 'browser', 'index.js');
  await build({
    entryPoints: [target],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias,
    external: ['*.node', 'typescript', 'electron', '@graphframework/desktop/*'],
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
