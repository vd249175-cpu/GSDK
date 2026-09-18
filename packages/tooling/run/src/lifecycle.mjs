import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parseRunConfig } from './config.mjs';
import { acquireRunLock, clearActiveRecord, readActiveRecord, readRunLock, writeActiveRecord } from './lock.mjs';
import { defaultGeneratedLayout, resolveRunRoot } from './paths.mjs';
import { appendStageLog, writeSnapshotRecord } from './record.mjs';
import { spawnEmptyKernel } from './kernel.mjs';
import { writeRunDiscovery } from './discovery.mjs';
import { loadRunNodes } from './assembly.mjs';
import { connectRunDaemon, injectLifecycleInfos, mountRunSlice, unmountRunSlice } from './mount.mjs';

async function importSdkEffect() {
  try {
    return await import('@graphvideo/sdk/effect');
  } catch {
    return await import(pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../../../sdk/javascript/dist/effect.js')).href);
  }
}

export function loadRunConfig(configPath) {
  const absolute = resolve(configPath);
  const runRoot = resolveRunRoot(absolute);
  const document = JSON.parse(readFileSync(absolute, 'utf8'));
  return parseRunConfig(document, { configPath: absolute, baseDirectory: runRoot });
}
function ensureLayout(parsed) {
  const layout = defaultGeneratedLayout(parsed.baseDirectory);
  for (const [key, directory] of Object.entries(layout)) {
    if (key === 'frontend' && (parsed.frontend.instances ?? []).length === 0) continue;
    mkdirSync(directory, { recursive: true });
  }
  return layout;
}

export function resolveDaemonBinary(parsed) {
  const exe = process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon';
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const candidates = [
    parsed.kernel.daemonPath,
    resolve(parsed.baseDirectory, '../../packages/rust/target/debug', exe),
    resolve(repoRoot, 'packages/rust/target/debug', exe),
    resolve('packages/rust/target/debug', exe),
  ].filter((entry) => typeof entry === 'string');
  for (const candidate of candidates) {
    const absolute = isAbsolute(candidate) ? candidate : resolve(parsed.baseDirectory, candidate);
    if (existsSync(absolute)) return absolute;
  }
  throw new Error('Rust kernel daemon binary not found; build graphvideo-kernel-daemon first');
}

function tokenPath(runtimeDirectory) {
  return join(runtimeDirectory, 'daemon-token');
}

function supervisorPidPath(runtimeDirectory) {
  return join(runtimeDirectory, 'supervisor.pid.json');
}

function writeSupervisorRecord(runtimeDirectory, record) {
  mkdirSync(runtimeDirectory, { recursive: true });
  writeFileSync(supervisorPidPath(runtimeDirectory), `${JSON.stringify(record, null, 2)}\n`);
}

function readSupervisorRecord(runtimeDirectory) {
  try {
    return JSON.parse(readFileSync(supervisorPidPath(runtimeDirectory), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function clearSupervisorRecord(runtimeDirectory, pid) {
  try {
    const record = readSupervisorRecord(runtimeDirectory);
    if (record && record.pid === pid) rmSync(supervisorPidPath(runtimeDirectory), { force: true });
  } catch { /* best effort */ }
}

/**
 * Derives one isolated Electron environment per frontend instance:
 * run-owned userData/data directories, run-scoped discovery paths, and a
 * loopback-only telemetry port default that callers may override explicitly.
 * No frontend instances means no allocation at all.
 */
function allocateFrontendEnvironment(parsed, runName, { address, pid }) {
  const instances = parsed.frontend.instances ?? [];
  if (instances.length === 0) return { enabled: false, instances: [] };
  const environments = instances.map((instance) => {
    const frontendRoot = join(parsed.baseDirectory, '.generated', 'frontend', runName, instance.id);
    const userDataPath = join(frontendRoot, 'electron-user-data');
    const dataDirectory = parsed.resources.dataDirectory;
    mkdirSync(userDataPath, { recursive: true });
    const agentControlPath = join(parsed.resources.runtimeDirectory, `agent-control.${instance.id}.json`);
    const discovery = {
      enabled: true,
      id: instance.id,
      plugin: instance.plugin,
      graph: instance.graph,
      entry: instance.entry,
      runName,
      kernel: { address, pid },
      userDataPath,
      dataDirectory,
      agentControlPath,
      telemetryPort: null,
      viteUrl: instance.entry,
    };
    return {
      id: instance.id,
      enabled: true,
      userDataPath,
      dataDirectory,
      agentControl: { discoveryPath: agentControlPath },
      discovery,
    };
  });
  const [first] = environments;
  return {
    enabled: true,
    instances: environments,
    userDataPath: first.userDataPath,
    dataDirectory: first.dataDirectory,
    agentControl: first.agentControl,
    discovery: first.discovery,
  };
}

const START_STAGES = ['validate', 'lock', 'kernel-ready', 'hosts-ready', 'admitted', 'workers-ready', 'initialized', 'started'];
const STOP_STAGES = ['stopping', 'settled', 'evicted', 'kernel-stopped', 'hosts-stopped', 'closed'];

function recordStage(parsed, runName, snapshot, stage) {
  const stages = [...(snapshot.stages ?? []), stage];
  const next = { ...snapshot, stages };
  writeSnapshotRecord(parsed.resources.runtimeDirectory, next);
  appendStageLog(parsed.resources.logsDirectory, runName, `stage ${stage}`);
  return next;
}

async function projectionMatchesReady(control, ready) {
  const projection = await control.projection();
  const node = projection.nodes?.[ready.nodeId];
  if (!node) return false;
  if (ready.state === undefined) return true;
  return Object.entries(ready.state).every(([key, value]) => (
    JSON.stringify(node.state?.[key]) === JSON.stringify(value)
  ));
}

async function waitForReady(control, ready, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'missing';
  for (;;) {
    const projection = await control.projection();
    const node = projection.nodes?.[ready.nodeId];
    if (node) {
      last = JSON.stringify(node.state ?? null).slice(0, 200);
      if (ready.state === undefined) return projection;
      const ok = Object.entries(ready.state).every(([key, value]) => (
        JSON.stringify(node.state?.[key]) === JSON.stringify(value)
      ));
      if (ok) return projection;
    }
    if (Date.now() > deadline) {
      throw new Error(`ready barrier timed out: ${ready.nodeId} state ${last}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Full start: validate config, take the same-name lock, prepare the run
 * layout, boot the kernel, assemble the real Node slice, admit every Node,
 * run the worker + effect provider, inject init/start Infos through the
 * settlement barrier, wait for the ready barrier, and persist the
 * active-run snapshot. The supervisor process (cli _run) owns the kernel
 * child, the worker loop, and the provider loop until stop.
 */
export async function startRun(configPath, { token, signal } = {}) {
  const parsed = loadRunConfig(configPath);
  const layout = ensureLayout(parsed);
  const runName = parsed.runName ?? 'run';
  let lock = null;
  let kernel = null;
  let control = null;
  let worker = null;
  let providerConn = null;
  let mount = null;
  let providing = null;
  const workerStop = new AbortController();
  const providerStop = new AbortController();
  if (signal) {
    signal.addEventListener('abort', () => {
      workerStop.abort();
      providerStop.abort();
    }, { once: true });
  }
  const onInterrupt = () => {
    workerStop.abort();
    providerStop.abort();
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onInterrupt);
  const credential = token ?? randomBytes(32).toString('hex');
  let snapshot = null;
  const startedAt = new Date().toISOString();
  try {
    lock = acquireRunLock(parsed.resources.runtimeDirectory, { runName, pid: process.pid });
    snapshot = {
      version: parsed.version,
      runName,
      pid: process.pid,
      configPath: parsed.configPath,
      startedAt,
      kernel: null,
      frontend: { enabled: false },
      discoveryPath: null,
      graph: parsed.graph,
      lifecycle: parsed.lifecycle,
      resources: parsed.resources,
      stages: ['validate', 'lock'],
    };
    writeSnapshotRecord(parsed.resources.runtimeDirectory, snapshot);
    appendStageLog(parsed.resources.logsDirectory, runName, `validate ok ${parsed.configPath}`);
    kernel = await spawnEmptyKernel(resolveDaemonBinary(parsed), {
      token: credential,
      bind: parsed.kernel.bind,
      timeoutMs: parsed.kernel.startupTimeoutMs,
    });
    appendStageLog(parsed.resources.logsDirectory, runName, `kernel ready ${kernel.address} pid ${kernel.pid}`);
    writeFileSync(tokenPath(parsed.resources.runtimeDirectory), credential, { mode: 0o600 });
    const frontend = allocateFrontendEnvironment(parsed, runName, kernel);
    const discoveryPath = writeRunDiscovery(parsed.resources.runtimeDirectory, {
      runName,
      kernel: { address: kernel.address, pid: kernel.pid },
      agentControl: frontend.enabled ? { discoveryPath: frontend.discovery.agentControlPath } : null,
      frontend: frontend.enabled ? frontend.discovery : null,
    });
    snapshot = {
      ...snapshot,
      kernel: {
        binary: resolveDaemonBinary(parsed),
        address: kernel.address,
        pid: kernel.pid,
        bind: parsed.kernel.bind,
      },
      frontend: frontend.enabled ? frontend.discovery : { enabled: false },
      frontends: frontend.enabled ? frontend.instances.map((entry) => entry.discovery) : [],
      discoveryPath,
      stages: [...snapshot.stages, 'kernel-ready', 'hosts-ready'],
    };
    writeSnapshotRecord(parsed.resources.runtimeDirectory, snapshot);
    // Assemble the real slice with run-scoped dependencies, then admit.
    // Empty slices (no graph instances) skip worker/provider: the kernel
    // stays authoritative with zero Nodes, and the ready barrier is vacuous.
    const { nodes } = await loadRunNodes(parsed, parsed.backend.dependencies ?? {});
    control = await connectRunDaemon({ address: kernel.address, token: credential });
    if (nodes.length > 0) {
      worker = await connectRunDaemon({ address: kernel.address, token: credential });
      providerConn = await connectRunDaemon({ address: kernel.address, token: credential });
      mount = await mountRunSlice({ nodes, control, worker, signal: workerStop.signal });
      snapshot = recordStage(parsed, runName, snapshot, 'admitted');
    } else {
      mount = { assemblies: [], handlers: {}, running: null, admitted: [] };
      snapshot = recordStage(parsed, runName, snapshot, 'admitted');
    }
    // Effect provider: run Node-owned adapters through the provider loop.
    // Slices without capabilities (including empty slices) skip the loop.
    const capabilities = [...new Set(mount.assemblies.flatMap((assembly) => assembly.effectCapabilities ?? []))];
    snapshot = recordStage(parsed, runName, snapshot, 'workers-ready');
    if (capabilities.length > 0) {
      const adapterById = new Map();
      for (const node of nodes) {
        for (const value of Object.values(node)) {
          if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
            && typeof value.execute === 'function') {
            adapterById.set(value.id, value);
          }
        }
      }
      const missing = capabilities.filter((id) => !adapterById.has(id));
      if (missing.length > 0) throw new Error(`missing adapters: ${missing.join(',')}`);
      const { runDaemonEffectProvider: runProvider } = await importSdkEffect();
      providing = runProvider(providerConn, {
        signal: providerStop.signal,
        adapters: Object.fromEntries(capabilities.map((id) => [id, (request, context) => (
          adapterById.get(id).execute(request, { signal: providerStop.signal, changeId: context.changeId, nodeId: context.nodeId })
        )])),
      });
      providing.catch(() => undefined);
    }
    const timeouts = parsed.lifecycle.timeouts ?? {};
    await injectLifecycleInfos({
      control,
      infos: parsed.lifecycle.initInfos,
      prefix: `${runName}/init`,
      timeoutMs: timeouts.initMs ?? 30_000,
    });
    await injectLifecycleInfos({
      control,
      infos: parsed.lifecycle.startInfos,
      prefix: `${runName}/start`,
      timeoutMs: timeouts.startMs ?? 30_000,
    });
    snapshot = recordStage(parsed, runName, snapshot, 'initialized');
    if (parsed.lifecycle.ready) {
      await waitForReady(control, parsed.lifecycle.ready, timeouts.startMs ?? 30_000);
    }
    snapshot = recordStage(parsed, runName, snapshot, 'started');
    writeSupervisorRecord(parsed.resources.runtimeDirectory, {
      runName,
      pid: process.pid,
      configPath: parsed.configPath,
      startedAt,
      kernel: snapshot.kernel,
    });
    writeActiveRecord(parsed.resources.runtimeDirectory, {
      runName, pid: process.pid, configPath: parsed.configPath, startedAt,
      kernel: snapshot.kernel,
    });
    return {
      parsed, layout, snapshot,
      kernel, control, worker, providerConn, mount,
      releaseLock: () => lock?.release(),
      stopKernel: () => kernel?.child.kill(),
      async stop() {
        await stopSupervised({
          parsed, runName, kernel, control, worker, providerConn, mount, providing,
          workerStop, providerStop, lock, timeouts,
        });
      },
    };
  } catch (error) {
    workerStop.abort();
    providerStop.abort();
    if (providing) await providing.catch(() => undefined);
    if (mount && control) {
      await unmountRunSlice({
        control, workerStop, running: mount.running, admitted: mount.admitted, assemblies: mount.assemblies,
      }).catch(() => undefined);
    }
    for (const client of [worker, providerConn, control]) {
      try { client?.close(); } catch { /* already closed */ }
    }
    if (kernel) kernel.child.kill();
    rmSync(tokenPath(parsed.resources.runtimeDirectory), { force: true });
    clearActiveRecord(parsed.resources.runtimeDirectory);
    clearSupervisorRecord(parsed.resources.runtimeDirectory, process.pid);
    if (lock) lock.release();
    throw error;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
  }
}

async function stopSupervised({
  parsed, runName, kernel, control, worker, providerConn, mount, providing,
  workerStop, providerStop, lock, timeouts = {},
}) {
  const stopTimeout = timeouts.stopMs ?? 30_000;
  const deadline = Date.now() + stopTimeout;
  const snapshotPath = join(parsed.resources.runtimeDirectory, 'config-snapshot.json');
  let snapshot = null;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  } catch { snapshot = null; }
  const mark = (stage) => {
    if (!snapshot) return;
    snapshot = recordStage(parsed, runName, snapshot, stage);
  };
  mark('stopping');
  try {
    if (control && parsed.lifecycle.stopInfos.length > 0) {
      await injectLifecycleInfos({
        control,
        infos: parsed.lifecycle.stopInfos,
        prefix: `${runName}/stop`,
        timeoutMs: Math.max(100, Math.min(stopTimeout, deadline - Date.now())),
      });
    }
    mark('settled');
  } finally {
    workerStop?.abort();
    providerStop?.abort();
    if (providing) await providing.catch(() => undefined);
    if (mount && control) {
      await unmountRunSlice({
        control, workerStop, running: mount.running, admitted: mount.admitted, assemblies: mount.assemblies,
      }).catch(() => undefined);
    }
    mark('evicted');
    for (const client of [worker, providerConn]) {
      try { client?.close(); } catch { /* already closed */ }
    }
    if (control) {
      try { await control.shutdown(); } catch { /* already closed */ }
      try { control.close(); } catch { /* already closed */ }
    }
    mark('kernel-stopped');
    if (kernel) {
      kernel.child.kill();
      await kernel.waitForExit(10_000).catch(() => undefined);
    }
    mark('hosts-stopped');
    rmSync(tokenPath(parsed.resources.runtimeDirectory), { force: true });
    clearActiveRecord(parsed.resources.runtimeDirectory);
    clearSupervisorRecord(parsed.resources.runtimeDirectory, process.pid);
    if (lock) lock.release();
    mark('closed');
    try {
      writeFileSync(
        join(parsed.resources.runtimeDirectory, 'close-result.json'),
        `${JSON.stringify({ runName, stopped: true, closedAt: new Date().toISOString() }, null, 2)}\n`,
      );
    } catch { /* best effort */ }
  }
}

export function statusRun(configPath) {
  try {
    const parsed = loadRunConfig(configPath);
    const active = readActiveRecord(parsed.resources.runtimeDirectory);
    const lock = readRunLock(parsed.resources.runtimeDirectory);
    const supervisor = readSupervisorRecord(parsed.resources.runtimeDirectory);
    let snapshot = null;
    try {
      snapshot = JSON.parse(readFileSync(join(parsed.resources.runtimeDirectory, 'config-snapshot.json'), 'utf8'));
    } catch { snapshot = null; }
    if (!active || !lock) {
      return {
        active: false,
        runName: parsed.runName ?? 'run',
        configPath: parsed.configPath,
        stages: snapshot?.stages ?? [],
      };
    }
    return {
      active: true, ...active, lockPid: lock.pid,
      supervisorPid: supervisor?.pid ?? null,
      stages: snapshot?.stages ?? [],
    };
  } catch {
    return { active: false, configPath: resolve(configPath) };
  }
}
/**
 * Detached stop: runs the full supervised close from a process that does not
 * own the kernel child (run.sh stop, Windows-safe). Connects with the run
 * token, injects stop Infos, settles, evicts every admitted Node, shuts the
 * daemon down via the token-authenticated channel, then terminates the
 * orphaned supervisor (its kernel child is already gone) and releases the
 * lock. Reads the activity snapshot, never the live config, for identity.
 */
async function stopDetached(runtime, snapshotName, parsed, timeouts = {}) {
  const snapshotPath = join(runtime, 'config-snapshot.json');
  let snapshot = null;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  } catch { snapshot = null; }
  const runName = snapshot?.runName ?? snapshotName;
  const mark = (stage) => {
    if (!snapshot || !parsed) return;
    snapshot = recordStage(parsed, runName, snapshot, stage);
  };
  mark('stopping');
  const credential = (() => {
    try {
      return readFileSync(join(runtime, 'daemon-token'), 'utf8').trim();
    } catch { return null; }
  })();
  let control = null;
  try {
    if (credential && snapshot?.kernel?.address) {
      control = await connectRunDaemon({ address: snapshot.kernel.address, token: credential });
      const stopInfos = parsed?.lifecycle.stopInfos ?? snapshot?.lifecycle?.stopInfos ?? [];
      if (stopInfos.length > 0) {
        await injectLifecycleInfos({
          control,
          infos: stopInfos,
          prefix: `${runName}/stop`,
          timeoutMs: timeouts.stopMs ?? 30_000,
        });
      }
    }
    mark('settled');
    if (control) {
      // Evict every Node the snapshot admitted, then shut the daemon down.
      // The worker already exited with the supervisor's event loop; evict
      // only needs the control channel.
      const admitted = snapshot?.stages?.includes('admitted')
        ? Object.keys((await control.projection().catch(() => ({ nodes: {} }))).nodes ?? {})
        : [];
      for (const nodeId of [...admitted].reverse()) {
        await control.evict?.(nodeId).catch(() => undefined);
      }
    }
    mark('evicted');
    if (control) {
      try { await control.shutdown(); } catch { /* already closed */ }
      try { control.close(); } catch { /* already closed */ }
    }
    mark('kernel-stopped');
    mark('hosts-stopped');
  } finally {
    try { control?.close(); } catch { /* already closed */ }
  }
  // The supervisor's kernel child is gone; terminate the orphaned supervisor
  // (Windows: SIGTERM kills without running its handlers, which is fine
  // because this path already closed everything it owned).
  const supervisor = readSupervisorRecord(runtime);
  if (supervisor && typeof supervisor.pid === 'number' && supervisor.pid !== process.pid) {
    try {
      process.kill(supervisor.pid, 'SIGTERM');
    } catch { /* already gone */ }
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        process.kill(supervisor.pid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    try {
      process.kill(supervisor.pid, 0);
      process.kill(supervisor.pid, 'SIGKILL');
    } catch { /* gone */ }
    clearSupervisorRecord(runtime, supervisor.pid);
  }
  rmSync(join(runtime, 'daemon-token'), { force: true });
  clearActiveRecord(runtime);
  rmSync(join(runtime, 'run.lock.json'), { force: true });
  mark('closed');
  try {
    writeFileSync(
      join(runtime, 'close-result.json'),
      `${JSON.stringify({ runName, stopped: true, closedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  } catch { /* best effort */ }
}

/**
 * Idempotent stop against the activity snapshot. Missing records mean
 * already stopped and succeed. Never reads the live config for the shutdown
 * target, so mid-run config edits cannot redirect this stop. When the
 * supervisor process for this run is live in this process tree, stop goes
 * through the full supervised path (stop Infos, settle, evict, daemon
 * shutdown); otherwise it records the close against the snapshot.
 */
export async function stopRun(configPath) {
  const absolute = resolve(configPath);
  const runRoot = resolveRunRoot(absolute);
  const fallbackRuntime = join(runRoot, '.generated', 'runtime');
  const active = readActiveRecord(fallbackRuntime);
  const lock = readRunLock(fallbackRuntime);
  let parsed = null;
  try {
    parsed = loadRunConfig(absolute);
  } catch {
    parsed = null;
  }
  const snapshotName = typeof active?.runName === 'string' ? active.runName : parsed?.runName ?? 'run';
  const snapshotLogs = typeof active?.configPath === 'string'
    ? join(resolveRunRoot(resolve(active.configPath)), '.generated', 'logs')
    : parsed?.resources.logsDirectory ?? join(runRoot, '.generated', 'logs');
  if (!active && !lock) {
    appendStageLog(snapshotLogs, snapshotName, 'stop noop (already stopped)');
    return { stopped: true, already: true, runName: snapshotName };
  }
  const runtime = parsed?.resources.runtimeDirectory ?? fallbackRuntime;
  const timeouts = parsed?.lifecycle.timeouts ?? {};
  // Detached close: this process does not own the kernel child, so run the
  // full supervised close over the token-authenticated control channel
  // (Windows-safe: no signal delivery required).
  await stopDetached(runtime, snapshotName, parsed, timeouts);
  appendStageLog(snapshotLogs, snapshotName, 'stop recorded');
  return { stopped: true, already: false, runName: snapshotName };
}

export { dirname };
export { START_STAGES, STOP_STAGES };
