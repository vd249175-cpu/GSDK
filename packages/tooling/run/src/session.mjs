import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseRunConfig } from './config.mjs';
import { writeSnapshotRecord, writeJsonRecord, appendStageLog } from './record.mjs';
import { callRunControl } from './control.mjs';
import { connectRunDaemon } from './mount.mjs';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const runtimeFor = (config) => join(dirname(resolve(config)), '.generated', 'runtime');
export const readSnapshot = (config) => JSON.parse(readFileSync(join(runtimeFor(config), 'config-snapshot.json'), 'utf8'));
export const sleep = (ms = 30) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export function loadRunConfig(config) {
  const configPath = resolve(config);
  return parseRunConfig(JSON.parse(readFileSync(configPath, 'utf8')), { configPath, baseDirectory: dirname(configPath) });
}
export function resolveDaemonBinary(parsed) {
  const supplied = parsed.kernel.daemonPath;
  const binary = supplied ?? join(repoRoot, 'packages/rust/target/debug/graphvideo-kernel-daemon');
  for (const candidate of [binary, ...(process.platform === 'win32' ? [`${binary}.exe`] : [])]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`kernel daemon binary not found: ${binary}`);
}
export function updateSession(config, patch = {}, stage) {
  const snapshot = readSnapshot(config);
  const next = { ...snapshot, ...patch, stages: stage && !snapshot.stages.includes(stage) ? [...snapshot.stages, stage] : snapshot.stages };
  writeSnapshotRecord(runtimeFor(config), next);
  if (stage) appendStageLog(next.parsed.resources.logsDirectory, next.runName, `stage ${stage}`);
  return next;
}
export function startResult(config, result) {
  const runtime = runtimeFor(config);
  writeJsonRecord(join(runtime, `start-result-${result.runId}.json`), result);
  try {
    if (readSnapshot(config).runId === result.runId) writeJsonRecord(join(runtime, 'start-result.json'), result);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const shellQuote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

/** Prepare immutable inputs. Rust and all hosts are started by Bash. */
export function prepareRun(config, runId = randomUUID()) {
  const parsed = loadRunConfig(config);
  const runtime = runtimeFor(config);
  if (parsed.resources.runtimeDirectory !== runtime || parsed.resources.generatedDirectory !== join(parsed.baseDirectory, '.generated')) {
    throw new Error('generated/runtime directories must use this run .generated and .generated/runtime');
  }
  const binary = resolveDaemonBinary(parsed);
  for (const directory of Object.values(parsed.resources)) mkdirSync(directory, { recursive: true });
  const lock = join(runtime, 'run.lock.json');
  try { writeFileSync(lock, JSON.stringify({ runId, runName: parsed.runName, acquiredAt: new Date().toISOString() }), { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Run is already active: ${parsed.runName}`); throw error; }
  try {
    const token = randomBytes(32).toString('hex');
    writeFileSync(join(runtime, 'daemon-token'), token, { mode: 0o600 });
    writeFileSync(join(runtime, 'control-token'), randomBytes(32).toString('hex'), { mode: 0o600 });
    rmSync(join(runtime, 'control.json'), { force: true });
    rmSync(join(runtime, 'close-result.json'), { force: true });
    const snapshot = { version: 2, runId, runName: parsed.runName, configPath: parsed.configPath, startedAt: new Date().toISOString(), state: 'starting', parsed, graph: parsed.graph, lifecycle: parsed.lifecycle, resources: parsed.resources, kernel: null, stages: ['validate', 'lock'] };
    writeSnapshotRecord(runtime, snapshot);
    const variables = { RUN_CONFIG: parsed.configPath, RUN_ID: runId, RUNTIME_DIR: runtime, KERNEL_BINARY: binary, GRAPHVIDEO_DAEMON_TOKEN: token, GRAPHVIDEO_DAEMON_BIND: parsed.kernel.bind };
    writeFileSync(join(runtime, 'environment.sh'), Object.entries(variables).map(([key, value]) => `export ${key}=${shellQuote(value)}`).join('\n') + '\n', { mode: 0o600 });
    return snapshot;
  } catch (error) { rmSync(lock, { force: true }); throw error; }
}

export async function kernelReady(config) {
  const snapshot = readSnapshot(config);
  const runtime = runtimeFor(config);
  const deadline = Date.now() + snapshot.parsed.kernel.startupTimeoutMs;
  for (;;) {
    try {
      const ready = JSON.parse(readFileSync(join(runtime, 'kernel.stdout'), 'utf8').split(/\r?\n/)[0]);
      const token = readFileSync(join(runtime, 'daemon-token'), 'utf8').trim();
      const client = await connectRunDaemon({ address: ready.address, token });
      try {
        const health = await client.health();
        if (health.pid !== ready.pid || health.closed) throw new Error('kernel ownership mismatch');
        return updateSession(config, { kernel: { ...ready, binary: resolveDaemonBinary(snapshot.parsed) } }, 'kernel-ready');
      } finally { client.close(); }
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(`kernel readiness failed: ${error.message}`);
      await sleep();
    }
  }
}

export async function awaitHost(config) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try { return await callRunControl(runtimeFor(config), 'health', {}, 1000); }
    catch (error) { if (Date.now() >= deadline) throw error; await sleep(); }
  }
}
export async function awaitStart(config, runId) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const result = JSON.parse(readFileSync(join(runtimeFor(config), `start-result-${runId}.json`), 'utf8'));
      if (result.runId === runId) {
        if (!result.started) throw new Error(result.error ?? 'run start failed');
        return result;
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (Date.now() >= deadline) throw new Error('run start timed out');
    await sleep();
  }
}

export async function kernelShutdown(config) {
  const snapshot = readSnapshot(config);
  const token = readFileSync(join(runtimeFor(config), 'daemon-token'), 'utf8').trim();
  const client = await connectRunDaemon({ address: snapshot.kernel.address, token });
  try {
    const health = await client.health();
    if (health.pid !== snapshot.kernel.pid) throw new Error('kernel ownership mismatch');
    if (health.nodes || health.pending || health.leases || health.effects || health.effectLeases) throw new Error('kernel still owns unsettled resources');
    const result = await client.shutdown();
    if (!result.shutdown) throw new Error('kernel refused shutdown');
  } finally { client.close(); }
}
export function finalizeRun(config, exitCode = 0) {
  const runtime = runtimeFor(config);
  const snapshot = readSnapshot(config);
  const lock = JSON.parse(readFileSync(join(runtime, 'run.lock.json'), 'utf8'));
  if (lock.runId !== snapshot.runId) throw new Error('run lock ownership mismatch');
  writeJsonRecord(join(runtime, 'close-result.json'), { runId: snapshot.runId, runName: snapshot.runName, stopped: true, exitCode, closedAt: new Date().toISOString() });
  for (const file of ['daemon-token', 'control-token', 'run.lock.json', 'control.json', 'environment.sh']) rmSync(join(runtime, file), { force: true });
  updateSession(config, { state: 'closed' }, 'closed');
}
export function statusRun(config) {
  try {
    const snapshot = readSnapshot(config);
    return { ...snapshot, parsed: undefined, active: snapshot.state !== 'closed' && existsSync(join(runtimeFor(config), 'run.lock.json')) };
  } catch (error) { if (error.code === 'ENOENT') return { active: false, runName: basename(dirname(resolve(config))) }; throw error; }
}
export async function stopRun(config) {
  const runtime = runtimeFor(config);
  const status = statusRun(config);
  if (!status.active) return { stopped: true, already: true, runName: status.runName };
  const receipt = await callRunControl(runtime, 'request-stop');
  const deadline = Date.now() + 120_000;
  for (;;) {
    const snapshot = readSnapshot(config);
    if (snapshot.runId !== receipt.runId) throw new Error('run identity changed during stop');
    if (snapshot.state === 'closed') return { stopped: true, already: false, runName: snapshot.runName };
    if (snapshot.state === 'stop-failed' && snapshot.stopAttempt === receipt.attempt) throw new Error(snapshot.lastError);
    if (Date.now() >= deadline) throw new Error('run close confirmation timed out');
    await sleep();
  }
}

/** Test/composition callers use the exact same root Bash entry. */
export async function startRun(config) {
  const bash = process.env.GRAPHVIDEO_BASH ?? (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
  const result = await promisify(execFile)(bash, [join(repoRoot, 'run.sh'), 'start', resolve(config)], { cwd: repoRoot, windowsHide: true, timeout: 150_000 });
  const snapshot = JSON.parse(result.stdout);
  const parsed = readSnapshot(config).parsed;
  if (snapshot.scenario) return { parsed, snapshot, report: snapshot.report, async stop() { return stopRun(config); } };
  const control = await connectRunDaemon({ address: snapshot.kernel.address, token: readFileSync(join(runtimeFor(config), 'daemon-token'), 'utf8').trim() });
  return { parsed, snapshot, control, kernel: { address: snapshot.kernel.address, pid: snapshot.kernel.pid },
    async stop() { control.close(); return stopRun(config); },
    stopKernel() { return stopRun(config); },
    releaseLock() { /* Only the owning Bash supervisor can release a run lock. */ },
  };
}
