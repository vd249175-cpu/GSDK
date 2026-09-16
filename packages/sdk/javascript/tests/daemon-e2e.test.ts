import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';
import { connectKernelDaemon } from '../src/agent/daemon-client';
import { runDaemonNodeWorker } from '../src/node/daemon-node';
import { runDaemonEffectProvider } from '../src/effect/daemon-effect';

const executable = resolve(
  'target', 'debug', process.platform === 'win32'
    ? 'graphvideo-kernel-daemon.exe'
    : 'graphvideo-kernel-daemon',
);
const portablePythonNode = fileURLToPath(new URL('./fixtures/daemon-portable-python-node.py', import.meta.url));
const pythonAvailable = spawnSync('python', ['--version'], { windowsHide: true }).status === 0;
const children: ChildProcessWithoutNullStreams[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => new Promise<void>((resolveExit) => {
    child.once('exit', () => resolveExit());
    child.kill();
    if (child.exitCode !== null) resolveExit();
  })));
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function startDaemon(): Promise<{ child: ChildProcessWithoutNullStreams; address: string; token: string }> {
  const token = 'fixture-secret-0001';
  const child = spawn(executable, [], {
    env: { ...process.env, GRAPHVIDEO_DAEMON_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const ready = await new Promise<{ address: string }>((resolveReady, reject) => {
    lines.once('line', (line) => resolveReady(JSON.parse(line)));
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`kernel daemon exited during startup: ${code}`)));
  });
  lines.close();
  return { child, address: ready.address, token };
}

describe.skipIf(!existsSync(executable))('Rust daemon with external workers', () => {
  it.skipIf(!pythonAvailable)('executes a standard-library Python Node copied to an arbitrary directory', async () => {
    const daemon = await startDaemon();
    const control = await connectKernelDaemon(daemon);
    const checkout = mkdtempSync(join(tmpdir(), 'graphvideo-portable-node-'));
    temporaryDirectories.push(checkout);
    const entry = join(checkout, 'worker.py');
    copyFileSync(portablePythonNode, entry);
    try {
      await control.admit('portable.python', { runs: 0 });
      const worker = spawn('python', ['-u', 'worker.py'], {
        cwd: checkout,
        env: {
          ...process.env,
          GRAPHVIDEO_DAEMON_ADDRESS: daemon.address,
          GRAPHVIDEO_DAEMON_TOKEN: daemon.token,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      children.push(worker);
      let stderr = '';
      worker.stderr.on('data', (data: Buffer) => { stderr += data.toString('utf8'); });
      const exited = new Promise<void>((resolveExit, reject) => {
        worker.once('error', reject);
        worker.once('exit', (code) => code === 0
          ? resolveExit()
          : reject(new Error(`portable Python Node exited with ${code}: ${stderr}`)));
      });
      await control.inject('portable.python', { type: 'RunInfo' }, 'portable/python/e2e');
      await exited;
      const projection = await control.projection() as any;
      expect(projection.nodes['portable.python']).toMatchObject({
        state: { runs: 1 }, version: 1, generation: 0,
      });
      expect(projection.submissions['portable/python/e2e'].status).toBe('completed');
    } finally {
      control.close();
    }
  });

  it('executes a JS change while Rust retains authoritative State and submission settlement', async () => {
    const daemon = await startDaemon();
    const control = await connectKernelDaemon(daemon);
    const worker = await connectKernelDaemon(daemon);
    const stop = new AbortController();
    try {
      await control.admit('counter', { count: 0 });
      await worker.claim(['counter']);
      const running = runDaemonNodeWorker(worker, {
        signal: stop.signal,
        handlers: {
          counter(_info, ctx) {
            ctx.write('count', Number(ctx.read('count')) + 1);
            stop.abort();
          },
        },
      });
      await control.inject('counter', { type: 'IncrementInfo' }, 'e2e/1');
      await running;
      const projection = await control.projection() as any;
      expect(projection.nodes.counter).toMatchObject({ state: { count: 1 }, version: 1, generation: 0 });
      expect(projection.submissions['e2e/1'].status).toBe('completed');
      expect((await control.health()).pid).toBe(daemon.child.pid);
    } finally {
      worker.close();
      control.close();
    }
  });

  it('brokers a capability-bound physical Effect without teaching Rust its meaning', async () => {
    const daemon = await startDaemon();
    const control = await connectKernelDaemon(daemon);
    const worker = await connectKernelDaemon(daemon);
    const provider = await connectKernelDaemon(daemon);
    const workerStop = new AbortController();
    const providerStop = new AbortController();
    try {
      await control.admit('world', { observed: null }, undefined, ['fixture/double']);
      await worker.claim(['world']);
      await provider.claimEffects(['fixture/double']);
      const providing = runDaemonEffectProvider(provider, {
        signal: providerStop.signal,
        adapters: {
          'fixture/double': (request) => {
            providerStop.abort();
            return { value: Number((request as any).value) * 2 };
          },
        },
      });
      const running = runDaemonNodeWorker(worker, {
        signal: workerStop.signal,
        handlers: {
          async world(_info, ctx) {
            const observed = await ctx.effect('fixture/double', { value: 4 });
            ctx.write('observed', observed);
            workerStop.abort();
          },
        },
      });
      await control.inject('world', { type: 'RunInfo' }, 'effect/e2e');
      await Promise.all([running, providing]);
      const projection = await control.projection() as any;
      expect(projection.nodes.world.state.observed).toEqual({ value: 8 });
      expect(projection.submissions['effect/e2e'].status).toBe('completed');
    } finally {
      provider.close();
      worker.close();
      control.close();
    }
  });
});
