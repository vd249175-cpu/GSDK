import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

/**
 * Spawns an empty Rust kernel daemon and waits for its ready DTO on stdout.
 * Identity is the loopback address plus the daemon PID from the DTO, never a
 * bare PID guessed from elsewhere. Control-plane requests use a separate
 * connection from worker long-polls.
 */
export async function spawnEmptyKernel(binary, {
  token = randomBytes(32).toString('hex'),
  bind = '127.0.0.1:0',
  timeoutMs = 10_000,
  signal,
} = {}) {
  if (typeof binary !== 'string' || !binary) throw new Error('kernel binary is required');
  if (token.length < 16) throw new Error('kernel token must have at least 16 bytes');
  const child = spawn(binary, [], {
    env: {
      ...process.env,
      GRAPHFRAMEWORK_DAEMON_TOKEN: token,
      GRAPHVIDEO_DAEMON_TOKEN: token,
      GRAPHFRAMEWORK_DAEMON_BIND: bind,
      GRAPHVIDEO_DAEMON_BIND: bind,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    signal,
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stderr = [];
  child.stderr?.on('data', (chunk) => stderr.push(chunk.toString('utf8')));
  const ready = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`kernel daemon did not report readiness within ${timeoutMs}ms`));
    }, timeoutMs);
    lines.once('line', (line) => {
      clearTimeout(timer);
      try {
        resolveReady(JSON.parse(line));
      } catch (error) {
        reject(new Error(`kernel daemon reported invalid ready DTO: ${line}`, { cause: error }));
      }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`kernel daemon exited during startup: ${code} ${stderr.join('')}`));
    });
  }).finally(() => lines.close());
  if (typeof ready.address !== 'string' || typeof ready.pid !== 'number') {
    child.kill();
    throw new Error(`kernel daemon reported an invalid endpoint: ${JSON.stringify(ready)}`);
  }
  return {
    child,
    token,
    address: ready.address,
    pid: ready.pid,
    async waitForExit(timeout = 10_000) {
      const exited = await new Promise((resolveExit) => {
        if (child.exitCode !== null) resolveExit(child.exitCode);
        else {
          const timer = setTimeout(() => resolveExit(null), timeout);
          child.once('exit', (code) => { clearTimeout(timer); resolveExit(code); });
        }
      });
      return exited;
    },
  };
}
