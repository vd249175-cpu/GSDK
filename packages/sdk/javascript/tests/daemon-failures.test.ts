import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { connectKernelDaemon, type KernelDaemonClient } from '../src/agent/daemon-client';
import { runDaemonNodeWorker } from '../src/node/daemon-node';
import { admitDaemonNodes } from '../src/node/daemon-node';

const executable = fileURLToPath(new URL(
  `../../../rust/target/debug/${process.platform === 'win32' ? 'graphframework-kernel-daemon.exe' : 'graphframework-kernel-daemon'}`,
  import.meta.url,
));

const daemons: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  for (const child of daemons.splice(0)) child.kill();
});

async function startDaemon(token: string): Promise<{ control: KernelDaemonClient; address: string }> {
  const child = spawn(executable, [], {
    env: { ...process.env, GRAPHFRAMEWORK_DAEMON_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  daemons.push(child);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const ready = await new Promise<{ address: string }>((resolveReady, reject) => {
    lines.once('line', (line) => resolveReady(JSON.parse(line)));
    child.once('error', reject);
  });
  lines.close();
  const control = await connectKernelDaemon({ address: ready.address, token });
  return { control, address: ready.address };
}

describe.skipIf(!existsSync(executable))('P2 daemon failure boundaries', () => {
  it('rejects an effect request with no provider and an unknown adapter', async () => {
    const token = 'p2-failure-secret-0001';
    const { control, address } = await startDaemon(token);
    const worker = await connectKernelDaemon({ address, token });
    try {
      await control.admit('example.exec', { observed: 0 }, undefined, ['fixture/double']);
      await worker.claim(['example.exec']);
      const polled = await (async () => {
        await control.inject('example.exec', { type: 'RunInfo' }, 'p2/fail/1');
        for (let round = 0; round < 100; round += 1) {
          const change = await worker.poll(100);
          if (change) return change;
        }
        throw new Error('change was not delivered');
      })();
      // No provider is online: the daemon refuses the request before any
      // physical work starts, and the change stays owned by this worker.
      await expect(worker.requestEffect(polled.change.changeId, 'fixture/double', { value: 1 }))
        .rejects.toThrow('no connected provider');
      // An undeclared capability is refused even with the same shape.
      await expect(worker.requestEffect(polled.change.changeId, 'fixture/unknown', { value: 1 }))
        .rejects.toThrow('capability was not granted');
      await worker.commit(polled.change.changeId, []);
      await worker.release(['example.exec']);
      await control.evict('example.exec');
      expect((await control.shutdown())).toMatchObject({ shutdown: true });
    } finally {
      worker.close();
      control.close();
    }
  }, 30_000);

  it('fails the orphaned change and releases the lease when a worker disconnects', async () => {
    const token = 'p2-failure-secret-0002';
    const { control, address } = await startDaemon(token);
    const worker = await connectKernelDaemon({ address, token });
    const errors = await connectKernelDaemon({ address, token });
    try {
      await control.admit('example.errors', { count: 0 });
      await control.setErrorTarget('example.errors');
      await control.admit('example.orphan', { count: 0 });
      await worker.claim(['example.orphan']);
      await control.inject('example.orphan', { type: 'RunInfo' }, 'p2/orphan/1');
      const polled = await worker.poll(5000);
      expect(polled?.change.nodeId).toBe('example.orphan');
      // Disconnect with the change still active: fail_change routes the error
      // Info and frees single-flight; the lease goes with the connection.
      worker.close();
      await errors.claim(['example.errors']);
      const observed = await (async () => {
        for (let round = 0; round < 200; round += 1) {
          const next = await errors.poll(100);
          if (next?.change.nodeId === 'example.errors' && next.change.info.type === '@error/NodeFailed') {
            await errors.commit(next.change.changeId, []);
            return next.change.info;
          }
        }
        throw new Error('disconnect error Info was not delivered');
      })();
      expect(observed).toMatchObject({ type: '@error/NodeFailed', nodeId: 'example.orphan' });
      // The lease died with the connection: a fresh worker can claim again.
      const recovery = await connectKernelDaemon({ address, token });
      try {
        await recovery.claim(['example.orphan']);
        await recovery.release(['example.orphan']);
      } finally {
        recovery.close();
      }
      await errors.release(['example.errors']).catch(() => undefined);
      await control.evict('example.orphan');
      await control.evict('example.errors');
      expect((await control.shutdown())).toMatchObject({ shutdown: true });
    } finally {
      errors.close();
      control.close();
    }
  }, 30_000);

  it('evicts only the admitted prefix when a later admit fails', async () => {
    const token = 'p2-failure-secret-0003';
    const { control } = await startDaemon(token);
    try {
      await control.admit('example.first', { count: 0 });
      // Duplicate admit fails: the first Node stays admitted, nothing half
      // assembled, and the error names the conflict.
      await expect(control.admit('example.first', { count: 0 })).rejects.toThrow();
      const health = await control.health() as { nodes: number };
      expect(health.nodes).toBe(1);
      await control.evict('example.first');
      expect((await control.shutdown())).toMatchObject({ shutdown: true });
    } finally {
      control.close();
    }
  }, 30_000);

  it('keeps a stale-connection commit from touching the replaced generation', async () => {
    const token = 'p2-failure-secret-0004';
    const { control, address } = await startDaemon(token);
    const worker = await connectKernelDaemon({ address, token });
    try {
      const { Node } = await import('../src/node/node');
      class FlapNode extends Node<{ count: number }> {
        protected override change(): void {}
      }
      const first = new FlapNode('example.flap', 'Flap', { count: 0 });
      const { handlers } = await admitDaemonNodes(control, [first]);
      const stop = new AbortController();
      const running = runDaemonNodeWorker(worker, { handlers, signal: stop.signal, longPollMs: 50 });
      // Let the worker drain the injected change first: replace only runs in
      // the single-flight gap, so the old generation settles before the swap.
      await control.inject('example.flap', { type: 'RunInfo' }, 'p2/flap/1');
      stop.abort();
      await running;
      const replaced = await control.replace('example.flap', { count: 100 });
      expect(replaced).toMatchObject({ generation: 1 });
      const projection = await control.projection();
      expect(projection.nodes['example.flap']).toMatchObject({ state: { count: 100 }, generation: 1 });
      await control.evict('example.flap');
      expect((await control.shutdown())).toMatchObject({ shutdown: true });
    } finally {
      worker.close();
      control.close();
    }
  }, 30_000);
});
