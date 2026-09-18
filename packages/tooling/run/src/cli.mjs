import { resolve } from 'node:path';
import { startRun, statusRun, stopRun } from './lifecycle.mjs';

const [op, configArg] = process.argv.slice(2);
if (!op || !configArg || !['start', 'stop', 'status', '_run'].includes(op)) {
  console.error('Usage: node packages/tooling/run/src/cli.mjs start|stop|status runs/<name>/run.config.json');
  process.exitCode = 2;
} else if (op === 'status') {
  console.log(JSON.stringify(statusRun(resolve(configArg)), null, 2));
} else if (op === 'stop') {
  console.log(JSON.stringify(await stopRun(resolve(configArg)), null, 2));
} else if (op === '_run') {
  // Background supervisor: owns kernel/worker/provider for the run lifetime.
  // Prints the started record on stdout, then sleeps until a shutdown signal
  // arrives (run.sh stop sends SIGTERM; Ctrl+C sends SIGINT), at which point
  // the full supervised close runs (stop Infos, settle, evict, daemon
  // shutdown) before exiting.
  const handle = await startRun(resolve(configArg));
  console.log(JSON.stringify({
    started: true,
    runName: handle.snapshot.runName,
    pid: handle.snapshot.pid,
    configPath: handle.snapshot.configPath,
    kernel: handle.snapshot.kernel,
    stages: handle.snapshot.stages,
  }, null, 2));
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await handle.stop();
    } catch (error) {
      console.error(`supervisor shutdown failed: ${error?.message ?? error}`);
      try { handle.stopKernel(); } catch { /* already closed */ }
      try { handle.releaseLock(); } catch { /* already closed */ }
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGHUP', () => void shutdown());
  // Sleep until stopped externally.
  const keepAlive = setInterval(() => undefined, 1000);
  keepAlive.unref?.();
  await new Promise(() => undefined);
} else {
  // Foreground start is not supported: interactive runs need a supervisor
  // that outlives the start command. Use `bash ./run.sh start <config>`.
  console.error('run start must go through the supervisor: bash ./run.sh start runs/<name>/run.config.json');
  process.exitCode = 2;
}
