import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parseRunConfig } from './config.mjs';
import { acquireRunLock, clearActiveRecord, readActiveRecord, readRunLock, writeActiveRecord } from './lock.mjs';
import { defaultGeneratedLayout, resolveRunRoot } from './paths.mjs';
import { appendStageLog, writeSnapshotRecord } from './record.mjs';
import { spawnEmptyKernel } from './kernel.mjs';
import { writeRunDiscovery } from './discovery.mjs';

export function loadRunConfig(configPath) {
  const absolute = resolve(configPath);
  const runRoot = resolveRunRoot(absolute);
  const document = JSON.parse(readFileSync(absolute, 'utf8'));
  return parseRunConfig(document, { configPath: absolute, baseDirectory: runRoot });
}
function ensureLayout(parsed) {
  const layout = defaultGeneratedLayout(parsed.baseDirectory);
  for (const [key, directory] of Object.entries(layout)) {
    if (key === 'frontend' && !parsed.frontend.enabled) continue;
    mkdirSync(directory, { recursive: true });
  }
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

/**
 * Derives the isolated Electron environment for one frontend-enabled run:
 * run-owned userData/data directories, run-scoped discovery paths, and a
 * loopback-only telemetry port default that callers may override explicitly.
 * No-frontend fragments return disabled and allocate nothing.
 */
function allocateFrontendEnvironment(parsed, runName, { address, pid }) {
  if (!parsed.frontend.enabled) return { enabled: false };
  const frontendRoot = join(parsed.baseDirectory, '.generated', 'frontend', runName);
  const userDataPath = join(frontendRoot, 'electron-user-data');
  const dataDirectory = parsed.resources.dataDirectory;
  mkdirSync(userDataPath, { recursive: true });
  const agentControlPath = join(parsed.resources.runtimeDirectory, 'agent-control.json');
  const discovery = {
    enabled: true,
    runName,
    kernel: { address, pid },
    userDataPath,
    dataDirectory,
    agentControlPath,
    telemetryPort: null,
    viteUrl: parsed.frontend.entry,
  };
  return {
    enabled: true,
    userDataPath,
    dataDirectory,
    agentControl: { discoveryPath: agentControlPath },
    discovery,
  };
}

/**
 * Full start: validate config, take the same-name lock, prepare the run
 * layout, boot an empty kernel, publish the run-scoped frontend discovery,
 * and persist the active-run snapshot. Node admission and Info injection
 * belong to later P3 stages; this stage proves the kernel endpoint is ready
 * and owned by this run.
 */
export async function startRun(configPath, { token } = {}) {
  const parsed = loadRunConfig(configPath);
  const layout = ensureLayout(parsed);
  const runName = parsed.runName ?? 'run';
  let lock = null;
  let kernel = null;
  const credential = token ?? randomBytes(32).toString('hex');
  try {
    lock = acquireRunLock(parsed.resources.runtimeDirectory, { runName, pid: process.pid });
    appendStageLog(parsed.resources.logsDirectory, runName, `validate ok ${parsed.configPath}`);
    kernel = await spawnEmptyKernel(resolveDaemonBinary(parsed), {
      token: credential,
      bind: parsed.kernel.bind,
      timeoutMs: parsed.kernel.startupTimeoutMs,
    });
    appendStageLog(parsed.resources.logsDirectory, runName, `kernel ready ${kernel.address} pid ${kernel.pid}`);
    // The credential lives only in the run's generated directory, never in
    // the committed config file.
    writeFileSync(tokenPath(parsed.resources.runtimeDirectory), credential, { mode: 0o600 });
    // No-frontend fragments skip Electron isolation entirely: no userData,
    // session, telemetry or agent discovery overrides are assigned here.
    const frontend = allocateFrontendEnvironment(parsed, runName, kernel);
    const discoveryPath = writeRunDiscovery(parsed.resources.runtimeDirectory, {
      runName,
      kernel: { address: kernel.address, pid: kernel.pid },
      agentControl: frontend.enabled ? { discoveryPath: frontend.discovery.agentControlPath } : null,
      frontend: frontend.enabled ? frontend.discovery : null,
    });
    const snapshot = {
      version: parsed.version,
      runName,
      pid: process.pid,
      configPath: parsed.configPath,
      startedAt: new Date().toISOString(),
      kernel: {
        binary: resolveDaemonBinary(parsed),
        address: kernel.address,
        pid: kernel.pid,
        bind: parsed.kernel.bind,
      },
      frontend: frontend.enabled ? frontend.discovery : { enabled: false },
      discoveryPath,
      graph: parsed.graph,
      lifecycle: parsed.lifecycle,
      resources: parsed.resources,
      stages: ['validate', 'lock', 'kernel-ready'],
    };
    writeSnapshotRecord(parsed.resources.runtimeDirectory, snapshot);
    writeActiveRecord(parsed.resources.runtimeDirectory, {
      runName, pid: process.pid, configPath: parsed.configPath, startedAt: snapshot.startedAt,
      kernel: snapshot.kernel,
    });
    return {
      parsed, layout, snapshot,
      kernel,
      releaseLock: () => lock?.release(),
      stopKernel: () => kernel?.child.kill(),
    };
  } catch (error) {
    if (kernel) kernel.child.kill();
    rmSync(tokenPath(parsed.resources.runtimeDirectory), { force: true });
    clearActiveRecord(parsed.resources.runtimeDirectory);
    if (lock) lock.release();
    throw error;
  }
}

export function statusRun(configPath) {
  try {
    const parsed = loadRunConfig(configPath);
    const active = readActiveRecord(parsed.resources.runtimeDirectory);
    const lock = readRunLock(parsed.resources.runtimeDirectory);
    if (!active || !lock) return { active: false, runName: parsed.runName ?? 'run', configPath: parsed.configPath };
    return { active: true, ...active, lockPid: lock.pid };
  } catch {
    return { active: false, configPath: resolve(configPath) };
  }
}

/**
 * Idempotent stop against the activity snapshot. Missing records mean
 * already stopped and succeed. Never reads the live config for the shutdown
 * target, so mid-run config edits cannot redirect this stop.
 */
export function stopRun(configPath) {
  const parsed = loadRunConfig(configPath);
  const active = readActiveRecord(parsed.resources.runtimeDirectory);
  const lock = readRunLock(parsed.resources.runtimeDirectory);
  // The run name comes from the activity snapshot, never the live config:
  // mid-run edits must not redirect shutdown at another run's resources.
  const snapshotName = typeof active?.runName === 'string' ? active.runName : parsed.runName ?? 'run';
  const snapshotLogs = typeof active?.configPath === 'string'
    ? join(resolveRunRoot(resolve(active.configPath)), '.generated', 'logs')
    : parsed.resources.logsDirectory;
  if (!active && !lock) {
    appendStageLog(snapshotLogs, snapshotName, 'stop noop (already stopped)');
    return { stopped: true, already: true, runName: snapshotName };
  }
  // The lock owner removes the lock on stop; a foreign stop leaves the owner
  // in place and still reports success idempotently without killing anything.
  // Clearing the active record first lets a same-process restart take the
  // lock immediately after this stop returns.
  clearActiveRecord(parsed.resources.runtimeDirectory);
  if (lock && active && lock.pid === active.pid && lock.pid === process.pid) {
    rmSync(join(parsed.resources.runtimeDirectory, 'run.lock.json'), { force: true });
  }
  appendStageLog(snapshotLogs, snapshotName, 'stop recorded');
  return { stopped: true, already: false, runName: snapshotName };
}

export { dirname };
