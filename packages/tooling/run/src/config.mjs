import { isAbsolute, resolve } from 'node:path';
import { basename, dirname } from 'node:path';

export const RUN_CONFIG_VERSION = 2;

const PLUGIN_ENTRY = /^[A-Za-z0-9._/-]+$/;
const NAMESPACE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function fail(message) {
  throw new Error(`Invalid run configuration: ${message}`);
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function assertNoUnknown(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${name} has unknown field: ${key}`);
  }
}

function assertPluginEntry(value, name) {
  if (typeof value !== 'string' || !PLUGIN_ENTRY.test(value) || isAbsolute(value)) {
    fail(`${name} must be a package-relative path, got ${JSON.stringify(value)}`);
  }
}

function normalizePlugins(value, baseDirectory) {
  const table = assertObject(value ?? {}, 'plugins');
  assertNoUnknown(table, ['backend', 'frontend'], 'plugins');
  const parse = (entries, kind, name) => {
    if (entries === undefined) return [];
    if (!Array.isArray(entries)) fail(`${name} must be an array`);
    const ids = new Set();
    return entries.map((plugin, index) => {
      assertObject(plugin, `${name}[${index}]`);
      assertNoUnknown(plugin, ['id', 'path'], `${name}[${index}]`);
      if (typeof plugin.id !== 'string' || !plugin.id) fail(`${name}[${index}].id must be a nonempty string`);
      if (ids.has(plugin.id)) fail(`duplicate plugin id: ${plugin.id}`);
      ids.add(plugin.id);
      if (typeof plugin.path !== 'string' || !plugin.path) fail(`${name}[${index}].path must be a nonempty string`);
      const directory = resolve(baseDirectory, plugin.path);
      return { id: plugin.id, path: plugin.path, directory, kind };
    });
  };
  const backend = parse(table.backend, 'backend', 'plugins.backend');
  const frontend = parse(table.frontend, 'frontend', 'plugins.frontend');
  const flat = [...backend, ...frontend];
  flat.backend = backend;
  flat.frontend = frontend;
  return flat;
}

function normalizeInstances(value, pluginIds) {
  if (!Array.isArray(value)) fail('graph.instances must be an array');
  const ids = new Set();
  return value.map((instance, index) => {
    const name = `graph.instances[${index}]`;
    assertObject(instance, name);
    assertNoUnknown(instance, ['kind', 'id', 'factory', 'params', 'bindings'], name);
    if (instance.kind !== 'node' && instance.kind !== 'graph') {
      fail(`${name}.kind must be node or graph`);
    }
    if (typeof instance.id !== 'string' || !instance.id) {
      fail(`${name}.id must be a nonempty string`);
    }
    if (/\s/.test(instance.id)) fail(`${name}.id must not contain whitespace`);
    if (ids.has(instance.id)) fail(`duplicate graph instance: ${instance.id}`);
    ids.add(instance.id);
    if (instance.kind === 'graph' && !NAMESPACE.test(instance.id)) {
      fail(`${name}.id must be a namespace (${NAMESPACE}), got ${JSON.stringify(instance.id)}`);
    }
    assertObject(instance.factory, `${name}.factory`);
    assertNoUnknown(instance.factory, ['plugin', 'name'], `${name}.factory`);
    if (typeof instance.factory.plugin !== 'string' || !instance.factory.plugin) {
      fail(`${name}.factory.plugin must be a plugin id`);
    }
    if (typeof instance.factory.name !== 'string' || !instance.factory.name) {
      fail(`${name}.factory.name must be an exported factory name`);
    }
    if (!pluginIds.has(instance.factory.plugin)) {
      fail(`${name}.factory.plugin references an undeclared plugin: ${instance.factory.plugin}`);
    }
    const params = instance.params === undefined ? {} : assertObject(instance.params, `${name}.params`);
    const bindings = instance.bindings === undefined ? {} : assertObject(instance.bindings, `${name}.bindings`);
    for (const [key, target] of Object.entries(bindings)) {
      if (typeof target !== 'string' || !target) {
        fail(`${name}.bindings[${key}] must be a nonempty Node id`);
      }
    }
    return {
      kind: instance.kind,
      id: instance.id,
      nodeId: instance.id,
      factory: { plugin: instance.factory.plugin, name: instance.factory.name },
      params,
      bindings,
    };
  });
}

function normalizeInfos(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${name} must be an array`);
  return value.map((entry, index) => {
    assertObject(entry, `${name}[${index}]`);
    assertNoUnknown(entry, ['targetNodeId', 'info'], `${name}[${index}]`);
    if (typeof entry.targetNodeId !== 'string' || !entry.targetNodeId) {
      fail(`${name}[${index}].targetNodeId must be a nonempty string`);
    }
    assertObject(entry.info, `${name}[${index}].info`);
    if (typeof entry.info.type !== 'string' || !entry.info.type) {
      fail(`${name}[${index}].info.type must be a nonempty string`);
    }
    return { targetNodeId: entry.targetNodeId, info: { ...entry.info } };
  });
}

function normalizeTimeouts(value) {
  if (value === undefined) return { initMs: 30_000, startMs: 30_000, stopMs: 30_000, settleMs: 30_000 };
  assertObject(value, 'lifecycle.timeouts');
  assertNoUnknown(value, ['initMs', 'startMs', 'stopMs', 'settleMs'], 'lifecycle.timeouts');
  const out = {};
  for (const key of ['initMs', 'startMs', 'stopMs', 'settleMs']) {
    const timeout = value[key] ?? 30_000;
    if (!Number.isFinite(timeout) || timeout < 100 || timeout > 300_000) {
      fail(`lifecycle.timeouts.${key} must be between 100 and 300000`);
    }
    out[key] = timeout;
  }
  return out;
}

function normalizeAssertions(value, scenarioIndex, nodeIds) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`scenarios[${scenarioIndex}].assertions must be an array`);
  return value.map((assertion, index) => {
    const name = `scenarios[${scenarioIndex}].assertions[${index}]`;
    assertObject(assertion, name);
    if ('nodeId' in assertion) {
      for (const key of Object.keys(assertion)) {
        if (!['nodeId', 'state', 'version'].includes(key)) fail(`${name} has unknown field: ${key}`);
      }
      if (typeof assertion.nodeId !== 'string' || !assertion.nodeId) fail(`${name}.nodeId must be a nonempty string`);
      if (!nodeIds.has(assertion.nodeId)) fail(`${name} asserts an unassembled Node: ${assertion.nodeId}`);
      if (assertion.state !== undefined) assertObject(assertion.state, `${name}.state`);
      if (assertion.version !== undefined && (!Number.isInteger(assertion.version) || assertion.version < 0)) {
        fail(`${name}.version must be a non-negative integer`);
      }
      return {
        nodeId: assertion.nodeId,
        ...(assertion.state === undefined ? {} : { state: { ...assertion.state } }),
        ...(assertion.version === undefined ? {} : { version: assertion.version }),
      };
    }
    if ('submission' in assertion) {
      for (const key of Object.keys(assertion)) {
        if (!['submission', 'status'].includes(key)) fail(`${name} has unknown field: ${key}`);
      }
      if (typeof assertion.submission !== 'string' || !assertion.submission) fail(`${name}.submission must be a nonempty string`);
      if (!['completed', 'failed', 'cancelled'].includes(assertion.status)) {
        fail(`${name}.status must be completed, failed or cancelled`);
      }
      return { submission: assertion.submission, status: assertion.status };
    }
    fail(`${name} must declare nodeId or submission`);
  });
}

function expandInstanceNodeIds(instances) {
  // Scenario/lifecycle addressing uses assembled Node IDs. Graph instances
  // expand via factory describe localIds when the assembly reports them;
  // until then the namespace prefix marks the whole product.
  const ids = new Set();
  for (const instance of instances) {
    if (instance.kind === 'node') ids.add(instance.nodeId);
    else ids.add(`${instance.nodeId}/*`);
  }
  return ids;
}

function normalizeScenarios(value, instances) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) fail('scenarios must be an array or null');
  const nodeIds = expandInstanceNodeIds(instances);
  const names = new Set();
  return value.map((scenario, index) => {
    const name = `scenarios[${index}]`;
    assertObject(scenario, name);
    for (const key of Object.keys(scenario)) {
      if (!['name', 'inputs', 'assertions', 'timeoutMs'].includes(key)) fail(`${name} has unknown field: ${key}`);
    }
    if (typeof scenario.name !== 'string' || !scenario.name) fail(`${name}.name must be a nonempty string`);
    if (names.has(scenario.name)) fail(`duplicate scenario name: ${scenario.name}`);
    names.add(scenario.name);
    const inputs = normalizeInfos(scenario.inputs ?? [], `${name}.inputs`);
    for (const input of inputs) {
      const ok = nodeIds.has(input.targetNodeId)
        || [...nodeIds].some((id) => id.endsWith('/*') && input.targetNodeId.startsWith(id.slice(0, -1)));
      if (!ok) fail(`${name} input targets an unassembled instance: ${input.targetNodeId}`);
    }
    const assertionScope = new Set([
      ...nodeIds,
      ...inputs.map((input) => input.targetNodeId),
    ]);
    const assertions = normalizeAssertions(scenario.assertions ?? [], index, {
      has: (id) => assertionScope.has(id)
        || [...assertionScope].some((known) => known.endsWith('/*') && id.startsWith(known.slice(0, -1))),
    });
    const timeoutMs = scenario.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) {
      fail(`${name}.timeoutMs must be between 100 and 300000`);
    }
    return { name: scenario.name, inputs, assertions, timeoutMs };
  });
}

function normalizeFrontend(value, pluginIds) {
  if (value === undefined) return { instances: [] };
  assertObject(value, 'frontend');
  assertNoUnknown(value, ['instances'], 'frontend');
  const instances = value.instances ?? [];
  if (!Array.isArray(instances)) fail('frontend.instances must be an array');
  const ids = new Set();
  return {
    instances: instances.map((entry, index) => {
      const name = `frontend.instances[${index}]`;
      assertObject(entry, name);
      assertNoUnknown(entry, ['id', 'plugin', 'graph', 'entry'], name);
      if (typeof entry.id !== 'string' || !entry.id) fail(`${name}.id must be a nonempty string`);
      if (ids.has(entry.id)) fail(`duplicate frontend instance: ${entry.id}`);
      ids.add(entry.id);
      if (typeof entry.plugin !== 'string' || !entry.plugin) fail(`${name}.plugin must be a plugin id`);
      if (!pluginIds.frontend.has(entry.plugin)) fail(`${name}.plugin is not a declared frontend plugin: ${entry.plugin}`);
      if (entry.graph !== null && entry.graph !== undefined && (typeof entry.graph !== 'string' || !entry.graph)) {
        fail(`${name}.graph must be a backend namespace or null`);
      }
      if (entry.entry !== undefined && entry.entry !== null) assertPluginEntry(entry.entry, `${name}.entry`);
      return { id: entry.id, plugin: entry.plugin, graph: entry.graph ?? null, entry: entry.entry ?? null };
    }),
  };
}

function normalizeResources(value, baseDirectory) {
  assertObject(value, 'resources');
  assertNoUnknown(
    value,
    ['generatedDirectory', 'dataDirectory', 'logsDirectory', 'runtimeDirectory'],
    'resources',
  );
  const resolveRunPath = (relativePath, name) => {
    if (typeof relativePath !== 'string' || !relativePath) fail(`resources.${name} must be a nonempty path`);
    if (isAbsolute(relativePath)) fail(`resources.${name} must be run-relative, got ${relativePath}`);
    return resolve(baseDirectory, relativePath);
  };
  return {
    generatedDirectory: resolveRunPath(value.generatedDirectory ?? '.generated', 'generatedDirectory'),
    dataDirectory: resolveRunPath(value.dataDirectory ?? '.generated/data', 'dataDirectory'),
    logsDirectory: resolveRunPath(value.logsDirectory ?? '.generated/logs', 'logsDirectory'),
    runtimeDirectory: resolveRunPath(value.runtimeDirectory ?? '.generated/runtime', 'runtimeDirectory'),
  };
}

/**
 * Parses a versioned run.config.json. Relative paths resolve against the
 * config file directory, which is the run resource root. Never evals config
 * content; plugin factories are resolved by explicit {plugin, name} references.
 */
export function parseRunConfig(document, { configPath, baseDirectory }) {
  assertObject(document, 'run configuration');
  assertNoUnknown(
    document,
    ['version', 'name', 'plugins', 'kernel', 'backend', 'frontend', 'graph', 'lifecycle', 'scenarios', 'resources'],
    'run configuration',
  );
  if (document.version !== RUN_CONFIG_VERSION) {
    fail(`unsupported version ${JSON.stringify(document.version)}, expected ${RUN_CONFIG_VERSION} (migrate to {plugins:{backend,frontend}, graph.instances[]:{kind,id,factory,params,bindings}})`);
  }
  if (typeof configPath !== 'string' || !configPath) fail('configPath is required');
  if (typeof baseDirectory !== 'string' || !baseDirectory) fail('baseDirectory is required');
  if (document.name !== undefined) {
    if (typeof document.name !== 'string' || !document.name) fail('name must be a nonempty string');
    if (basename(baseDirectory) !== document.name) {
      fail(`run name must match directory: ${JSON.stringify(document.name)}`);
    }
  }
  const plugins = normalizePlugins(document.plugins ?? {}, baseDirectory);
  const pluginIds = {
    backend: new Set(plugins.backend.map((plugin) => plugin.id)),
    frontend: new Set(plugins.frontend.map((plugin) => plugin.id)),
    has: (id) => plugins.some((plugin) => plugin.id === id),
  };

  const kernel = assertObject(document.kernel ?? {}, 'kernel');
  assertNoUnknown(kernel, ['daemonPath', 'bind', 'startupTimeoutMs', 'shutdownTimeoutMs'], 'kernel');
  if (kernel.daemonPath !== undefined && typeof kernel.daemonPath !== 'string') {
    fail('kernel.daemonPath must be a string');
  }
  const daemonPath = kernel.daemonPath === undefined
    ? null
    : resolve(baseDirectory, kernel.daemonPath);

  if (document.backend !== undefined) {
    assertObject(document.backend, 'backend');
    assertNoUnknown(document.backend, ['dependencies'], 'backend');
  }
  const backend = { dependencies: assertObject(document.backend?.dependencies ?? {}, 'backend.dependencies') };

  const frontend = normalizeFrontend(document.frontend, pluginIds);

  const graph = assertObject(document.graph ?? {}, 'graph');
  assertNoUnknown(graph, ['instances'], 'graph');
  const instances = normalizeInstances(graph.instances ?? [], pluginIds);

  const lifecycle = assertObject(document.lifecycle ?? {}, 'lifecycle');
  assertNoUnknown(lifecycle, ['initInfos', 'startInfos', 'stopInfos', 'ready', 'timeouts'], 'lifecycle');
  const initInfos = normalizeInfos(lifecycle.initInfos, 'lifecycle.initInfos');
  const startInfos = normalizeInfos(lifecycle.startInfos, 'lifecycle.startInfos');
  const stopInfos = normalizeInfos(lifecycle.stopInfos, 'lifecycle.stopInfos');
  let ready = null;
  if (lifecycle.ready !== undefined && lifecycle.ready !== null) {
    assertObject(lifecycle.ready, 'lifecycle.ready');
    assertNoUnknown(lifecycle.ready, ['nodeId', 'state'], 'lifecycle.ready');
    if (typeof lifecycle.ready.nodeId !== 'string' || !lifecycle.ready.nodeId) {
      fail('lifecycle.ready.nodeId must be a nonempty string');
    }
    if (lifecycle.ready.state !== undefined) assertObject(lifecycle.ready.state, 'lifecycle.ready.state');
    ready = {
      nodeId: lifecycle.ready.nodeId,
      ...(lifecycle.ready.state === undefined ? {} : { state: { ...lifecycle.ready.state } }),
    };
  }
  const timeouts = normalizeTimeouts(lifecycle.timeouts);

  const resources = normalizeResources(document.resources ?? {}, baseDirectory);

  return {
    version: RUN_CONFIG_VERSION,
    configPath,
    baseDirectory,
    runName: basename(baseDirectory),
    plugins,
    kernel: {
      daemonPath,
      bind: kernel.bind ?? '127.0.0.1:0',
      startupTimeoutMs: kernel.startupTimeoutMs ?? 10_000,
      shutdownTimeoutMs: kernel.shutdownTimeoutMs ?? 10_000,
    },
    backend,
    frontend,
    graph: { instances },
    lifecycle: { initInfos, startInfos, stopInfos, ready, timeouts },
    scenarios: normalizeScenarios(document.scenarios, instances),
    resources,
  };
}
