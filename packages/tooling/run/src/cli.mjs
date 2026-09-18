import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBackend } from './host.mjs';
import { callRunControl } from './control.mjs';
import { prepareRun, kernelReady, kernelShutdown, awaitHost, awaitStart, readSnapshot, runtimeFor, updateSession, finalizeRun, statusRun, stopRun, startResult, sleep, loadRunConfig, resolveDaemonBinary } from './session.mjs';

const [op, argument, extra] = process.argv.slice(2);
const config = argument ? resolve(argument) : null;
try {
  let result;
  if (op === 'id') result = randomUUID();
  else if (op === 'validate') { resolveDaemonBinary(loadRunConfig(config)); result = { valid: true }; }
  else if (op === 'prepare') result = prepareRun(config, extra);
  else if (op === 'kernel-ready') result = await kernelReady(config);
  else if (op === 'kernel-shutdown') { await kernelShutdown(config); result = { shutdown: true }; }
  else if (op === 'backend') await runBackend(config);
  else if (op === 'await-host') result = await awaitHost(config);
  else if (op === 'call') result = await callRunControl(runtimeFor(config), extra);
  else if (op === 'cancelled') {
    const health = await callRunControl(runtimeFor(config), 'health');
    process.exitCode = health.stopRequested ? 0 : 1;
  }
  else if (op === 'mark') result = updateSession(config, {}, extra);
  else if (op === 'fail-start') startResult(config, { runId: extra, started: false, error: 'run startup failed; see supervisor.log' });
  else if (op === 'fail-stop') result = await callRunControl(runtimeFor(config), 'stop-failed', { error: extra });
  else if (op === 'finalize') { finalizeRun(config, Number(extra ?? 0)); result = { closed: true }; }
  else if (op === 'await-start') {
    result = await awaitStart(config, extra);
    if (result.scenario) {
      for (;;) {
        const snapshot = readSnapshot(config);
        if (snapshot.state === 'stop-failed') throw new Error(snapshot.lastError);
        if (snapshot.state === 'closed') {
          const close = JSON.parse(readFileSync(join(runtimeFor(config), 'close-result.json'), 'utf8'));
          result = { ...result, report: snapshot.scenarioReport, stopped: true, exitCode: close.exitCode };
          process.exitCode = close.exitCode;
          break;
        }
        await sleep();
      }
    }
  }
  else if (op === 'stop') result = await stopRun(config);
  else if (op === 'status') {
    result = statusRun(config);
    if (result.active) {
      try { const health = await callRunControl(runtimeFor(config), 'health', {}, 1000); result = { ...result, verified: true, pid: health.pid }; }
      catch (error) { result = { ...result, active: false, state: 'unreachable', cleanupRequired: true, error: error.message }; }
    }
  }
  else throw new Error(`unknown run command: ${op}`);
  if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
} catch (error) { console.error(error?.stack ?? String(error)); process.exitCode = 1; }
