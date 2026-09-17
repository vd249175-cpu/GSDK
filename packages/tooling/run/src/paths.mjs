import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Guards that keep every writable run artifact inside its own run root. */
export function assertInsideRun(runRoot, candidate, label) {
  if (typeof candidate !== 'string' || !candidate) throw new Error(`${label} must be a nonempty path`);
  const target = resolve(runRoot, candidate);
  const rel = relative(runRoot, target);
  if (rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`${label} escapes the run root: ${candidate}`);
  }
  return target;
}

/** Backend/plugin entries stay package-relative, mirroring application.mjs rules. */
export function assertPluginEntry(pluginDirectory, entry) {
  if (typeof entry !== 'string' || !entry || isAbsolute(entry)) {
    throw new Error(`Invalid plugin entry: ${JSON.stringify(entry)}`);
  }
  const target = resolve(pluginDirectory, entry);
  const rel = relative(pluginDirectory, target);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Plugin entry escapes its plugin: ${entry}`);
  return target;
}

/**
 * Resolves the run resource root: the directory holding run.config.json.
 * Callers pass any cwd; only the config location determines the root, so the
 * same config parses identically from different working directories.
 */
export function resolveRunRoot(configPath) {
  if (typeof configPath !== 'string' || !configPath) throw new Error('configPath is required');
  return dirname(resolve(configPath));
}

/** every generated artifact path is derived from the run root. */
export function defaultGeneratedLayout(runRoot) {
  return {
    frontend: resolve(runRoot, '.generated/frontend'),
    backend: resolve(runRoot, '.generated/backend'),
    runtime: resolve(runRoot, '.generated/runtime'),
    data: resolve(runRoot, '.generated/data'),
    logs: resolve(runRoot, '.generated/logs'),
  };
}

/** Backend build output for a run; never beside plugin sources. */
export function runBackendOutfile(layout, pluginId, entry) {
  const safePlugin = String(pluginId).replace(/[^A-Za-z0-9._-]+/g, '_');
  const safeEntry = String(entry).replace(/[^A-Za-z0-9._-]+/g, '_');
  return resolve(layout.backend, `${safePlugin}.${safeEntry}.js`);
}
