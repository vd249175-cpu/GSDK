import { resolve } from 'node:path';
import { startRun, statusRun, stopRun } from './lifecycle.mjs';

const [op, configArg] = process.argv.slice(2);
if (!op || !configArg || !['start', 'stop', 'status'].includes(op)) {
  console.error('Usage: node packages/tooling/run/src/cli.mjs start|stop|status runs/<name>/run.config.json');
  process.exitCode = 2;
} else if (op === 'status') {
  console.log(JSON.stringify(statusRun(resolve(configArg)), null, 2));
} else if (op === 'stop') {
  console.log(JSON.stringify(stopRun(resolve(configArg)), null, 2));
} else {
  // start is intentionally foreground in this P3 slice: it validates, takes
  // the same-name lock, boots the empty kernel, and records identity. Later
  // stages will admit Nodes and inject Info before detaching for interaction.
  const handle = await startRun(resolve(configArg));
  console.log(JSON.stringify({
    started: true,
    runName: handle.snapshot.runName,
    pid: handle.snapshot.pid,
    configPath: handle.snapshot.configPath,
    kernel: handle.snapshot.kernel,
    stages: handle.snapshot.stages,
  }, null, 2));
  handle.stopKernel();
  handle.releaseLock();
}
