import { isAbsolute, resolve } from 'node:path';

export const RUN_CONFIG_VERSION = 1;

const PLUGIN_ENTRY = /^[A-Za-z0-9._/-]+$/;

function fail(message) {
  throw new Error(`Invalid run configuration: ${message}`);
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function assertPluginEntry(value, name) {
  if (typeof value !== 'string' || !PLUGIN_ENTRY.test(value) || isAbsolute(value)) {
    fail(`${name} must be a package-relative path, got ${JSON.stringify(value)}`);
  }
}

function normalizePlugins(value, baseDirectory) {
  if (!Array.isArray(value)) fail('plugins must be an array');
  const ids = new Set();
  return value.map((plugin, index) => {
    assertObject(plugin, `plugins[${index}]`);
    if (typeof plugin.id !== 'string' || !plugin.id) fail(`plugins[${index}].id must be a nonempty string`);
    if (ids.has(plugin.id)) fail(`duplicate plugin id: ${plugin.id}`);
    ids.add(plugin.id);
    if (typeof plugin.path !== 'string' || !plugin.path) fail(`plugins[${index}].path must be a nonempty string`);
    const directory = resolve(baseDirectory, plugin.path);
    return { id: plugin.id, path: plugin.path, directory };
  });
}

function normalizeInstances(value) {
  if (!Array.isArray(value)) fail('graph.instances must be an array');
  const ids = new Set();
  return value.map((instance, index) => {
    if (typeof instance === 'string') {
      if (!instance) fail(`graph.instances[${index}] must be a nonempty Node id`);
      if (ids.has(instance)) fail(`duplicate graph instance: ${instance}`);
      ids.add(instance);
      return { nodeId: instance };
    }
    assertObject(instance, `graph.instances[${index}]`);
    if (typeof instance.nodeId !== 'string' || !instance.nodeId) {
      fail(`graph.instances[${index}].nodeId must be a nonempty string`);
    }
    if (ids.has(instance.nodeId)) fail(`duplicate graph instance: ${instance.nodeId}`);
    ids.add(instance.nodeId);
    if (instance.factory === undefined) return { nodeId: instance.nodeId };
    assertObject(instance.factory, `graph.instances[${index}].factory`);
    if (typeof instance.factory.plugin !== 'string' || !instance.factory.plugin) {
      fail(`graph.instances[${index}].factory.plugin must be a plugin id`);
    }
    if (typeof instance.factory.name !== 'string' || !instance.factory.name) {
      fail(`graph.instances[${index}].factory.name must be an exported factory name`);
    }
    return { nodeId: instance.nodeId, factory: { plugin: instance.factory.plugin, name: instance.factory.name } };
  });
}

function normalizeInfos(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${name} must be an array`);
  return value.map((entry, index) => {
    assertObject(entry, `${name}[${index}]`);
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
function normalizeAssertions(value, scenarioIndex, instanceIds) {
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
      if (!instanceIds.has(assertion.nodeId)) fail(`${name} asserts an unassembled instance: ${assertion.nodeId}`);
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

function normalizeScenarios(value, instances) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) fail('scenarios must be an array or null');
  const instanceIds = new Set(instances.map((instance) => instance.nodeId));
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
      if (!instanceIds.has(input.targetNodeId)) {
        fail(`${name} input targets an unassembled instance: ${input.targetNodeId}`);
      }
    }
    const assertions = normalizeAssertions(scenario.assertions ?? [], index, instanceIds);
    const timeoutMs = scenario.timeoutMs ?? 30_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) {
      fail(`${name}.timeoutMs must be between 100 and 300000`);
    }
    return { name: scenario.name, inputs, assertions, timeoutMs };
  });
}

function normalizeResources(value, baseDirectory) {
  assertObject(value, 'resources');
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
  if (document.version !== RUN_CONFIG_VERSION) {
    fail(`unsupported version ${JSON.stringify(document.version)}, expected ${RUN_CONFIG_VERSION}`);
  }
  if (typeof configPath !== 'string' || !configPath) fail('configPath is required');
  if (typeof baseDirectory !== 'string' || !baseDirectory) fail('baseDirectory is required');
  const plugins = normalizePlugins(document.plugins ?? [], baseDirectory);

  const kernel = assertObject(document.kernel ?? {}, 'kernel');
  if (kernel.daemonPath !== undefined && typeof kernel.daemonPath !== 'string') {
    fail('kernel.daemonPath must be a string');
  }
  const daemonPath = kernel.daemonPath === undefined
    ? null
    : resolve(baseDirectory, kernel.daemonPath);

  const backend = assertObject(document.backend ?? {}, 'backend');
  if (backend.entry !== undefined && backend.entry !== null) assertPluginEntry(backend.entry, 'backend.entry');

  const frontend = assertObject(document.frontend ?? {}, 'frontend');
  if (frontend.enabled !== undefined && typeof frontend.enabled !== 'boolean') {
    fail('frontend.enabled must be a boolean');
  }
  if (frontend.entry !== undefined && frontend.entry !== null) assertPluginEntry(frontend.entry, 'frontend.entry');

  const graph = assertObject(document.graph ?? {}, 'graph');
  const instances = normalizeInstances(graph.instances ?? []);

  const lifecycle = assertObject(document.lifecycle ?? {}, 'lifecycle');
  const initInfos = normalizeInfos(lifecycle.initInfos, 'lifecycle.initInfos');
  const startInfos = normalizeInfos(lifecycle.startInfos, 'lifecycle.startInfos');
  const stopInfos = normalizeInfos(lifecycle.stopInfos, 'lifecycle.stopInfos');

  const resources = normalizeResources(document.resources ?? {}, baseDirectory);

  return {
    version: RUN_CONFIG_VERSION,
    configPath,
    baseDirectory,
    runName: document.name ?? null,
    plugins,
    kernel: {
      daemonPath,
      bind: kernel.bind ?? '127.0.0.1:0',
      startupTimeoutMs: kernel.startupTimeoutMs ?? 10_000,
      shutdownTimeoutMs: kernel.shutdownTimeoutMs ?? 10_000,
    },
    backend: {
      entry: backend.entry ?? null,
      dependencies: assertObject(backend.dependencies ?? {}, 'backend.dependencies'),
    },
    frontend: {
      enabled: frontend.enabled ?? false,
      entry: frontend.entry ?? null,
    },
    graph: { instances },
    lifecycle: { initInfos, startInfos, stopInfos },
    scenarios: normalizeScenarios(document.scenarios, instances),
    resources,
  };
}
