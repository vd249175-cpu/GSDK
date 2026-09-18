import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Loads plugin backend modules and constructs exactly the Nodes named by
 * graph.instances. Two construction paths:
 * - instance.factory {plugin, name}: call the plugin backend's named factory
 *   export directly, so slices never assemble the whole graph first;
 * - no factory: call backend.createNodes and require the constructed set to
 *   equal the configured instances exactly. Unselected Nodes are refused, not
 *   silently filtered, so a fragment cannot hide a whole-graph assembly.
 *
 * Backend createNodes takes {pluginId, dependencies}: dependencies carry
 * host-injected EffectAdapters and paths, never business State. Callers pass
 * the run's own adapters; Studio daemon runs use in-memory/file ports scoped
 * to the run's data directory, never Electron IPC.
 */
export async function loadRunNodes(parsed, dependencies = {}) {
  const backends = new Map();
  for (const plugin of parsed.plugins) {
    const manifest = JSON.parse(readFileSync(resolve(plugin.directory, 'graphvideo.plugin.json'), 'utf8'));
    if (manifest.id !== plugin.id) {
      throw new Error(`Plugin identity mismatch: ${plugin.id} (manifest says ${manifest.id})`);
    }
    const entry = manifest.contributes?.backend;
    if (typeof entry !== 'string' || !entry) throw new Error(`Plugin has no backend entry: ${plugin.id}`);
    const module = await import(pathToFileURL(resolveEntry(plugin.directory, entry)).href);
    const backend = module.default;
    if (!backend || backend.id !== plugin.id || typeof backend.createNodes !== 'function') {
      throw new Error(`Invalid backend plugin: ${plugin.id}`);
    }
    backends.set(plugin.id, backend);
  }
  const contextFor = (pluginId) => ({ pluginId, dependencies });
  const nodes = [];
  const seen = new Set();
  for (const instance of parsed.graph.instances) {
    if (seen.has(instance.nodeId)) throw new Error(`Duplicate graph instance: ${instance.nodeId}`);
    seen.add(instance.nodeId);
    nodes.push(await constructInstance(instance, backends, contextFor));
  }
  if (!parsed.graph.instances.some((instance) => instance.factory)) {
    // No explicit factories: every plugin's full product must be selected,
    // otherwise the fragment is silently hiding unselected Nodes.
    for (const [pluginId, backend] of backends) {
      const produced = await backend.createNodes(contextFor(pluginId)) ?? [];
      const producedIds = (Array.isArray(produced) ? produced : [produced]).map((node) => node?.id);
      const unselected = producedIds.filter((id) => typeof id === 'string' && !seen.has(id));
      if (unselected.length > 0) {
        throw new Error(
          `Plugin ${pluginId} constructs unselected Nodes (${unselected.join(', ')}); ` +
          `give each instance an explicit {plugin, name} factory reference`,
        );
      }
    }
  }
  return { backends, nodes };
}

async function constructInstance(instance, backends, contextFor) {
  if (instance.factory) {
    const backend = backends.get(instance.factory.plugin);
    if (!backend) {
      throw new Error(`Instance references an undeclared plugin: ${instance.nodeId} -> ${instance.factory.plugin}`);
    }
    const factory = backend[instance.factory.name];
    if (typeof factory !== 'function') {
      throw new Error(`Factory ${instance.factory.plugin}/${instance.factory.name} is not exported`);
    }
    const created = await factory(contextFor(instance.factory.plugin));
    const list = Array.isArray(created) ? created : [created];
    const match = list.filter((node) => node?.id === instance.nodeId);
    if (match.length === 0) {
      throw new Error(`Factory ${instance.factory.plugin}/${instance.factory.name} did not construct ${instance.nodeId}`);
    }
    if (match.length > 1) {
      throw new Error(`Factory ${instance.factory.plugin}/${instance.factory.name} constructed ${instance.nodeId} twice`);
    }
    return match[0];
  }
  for (const [pluginId, backend] of backends) {
    const created = await backend.createNodes(contextFor(pluginId)) ?? [];
    const list = Array.isArray(created) ? created : [created];
    const match = list.filter((node) => node?.id === instance.nodeId);
    if (match.length > 0) {
      if (match.length > 1) throw new Error(`Duplicate Node instance: ${instance.nodeId}`);
      return match[0];
    }
  }
  throw new Error(`No plugin constructed instance: ${instance.nodeId}`);
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
