import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { connectKernelDaemon, type KernelDaemonClient } from '../src/agent/daemon-client';
import { runDaemonEffectProvider } from '../src/effect/daemon-effect';
import { admitDaemonNodes, runDaemonNodeWorker } from '../src/node/daemon-node';
import { ExecutionWorldNode, Node, ObservationWorldNode } from '../src/node/node';

const executable = fileURLToPath(new URL(
  `../../../rust/target/debug/${process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon'}`,
  import.meta.url,
));

const daemons: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  for (const child of daemons.splice(0)) child.kill();
});

async function startDaemon(token: string): Promise<{ control: KernelDaemonClient; address: string }> {
  const child = spawn(executable, [], {
    env: { ...process.env, GRAPHVIDEO_DAEMON_TOKEN: token },
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

class CounterNode extends Node<{ count: number }> {
  constructor(id = 'example.counter') {
    super(id, 'Counter', { count: 0 });
  }

  protected override change(
    info: { readonly type: string; readonly [key: string]: unknown },
    ctx: {
      read(key: string): unknown;
      write(key: string, value: unknown): void;
      send(child: { readonly type: string; readonly [key: string]: unknown }, target: string): void;
    },
  ): void {
    if (info.type !== 'IncrementInfo') return;
    const count = Number(ctx.read('count')) + 1;
    ctx.write('count', count);
    ctx.send({ type: 'CountChangedInfo', count }, 'example.collector');
  }
}

class CollectorNode extends Node<{ seen: number }> {
  constructor() {
    super('example.collector', 'Collector', { seen: 0 });
  }

  protected override change(
    info: { readonly type: string; readonly [key: string]: unknown },
    ctx: { read(key: string): unknown; write(key: string, value: unknown): void },
  ): void {
    if (info.type !== 'CountChangedInfo') return;
    ctx.write('seen', Number(info.count));
  }
}

class BrokenNode extends Node<Record<string, never>> {
  constructor() {
    super('example.broken', 'Broken', {});
  }

  protected override change(): void {
    throw new Error('assembly failed');
  }
}

class DoublingExecutionNode extends ExecutionWorldNode<{ observed: number }> {
  constructor(private readonly effectAdapter: { readonly id: string }) {
    super('example.exec', 'DoublingExec', { observed: 0 });
  }

  protected override async change(
    info: { readonly type: string; readonly [key: string]: unknown },
    ctx: {
      write(key: string, value: unknown): void;
      effectAdapter(adapter: { readonly id: string }, request: unknown): Promise<unknown>;
      send(child: { readonly type: string; readonly [key: string]: unknown }, target: string): void;
    },
  ): Promise<void> {
    if (info.type !== 'RunInfo') return;
    const observed = await ctx.effectAdapter(this.effectAdapter, { value: 21 }) as { value: number };
    ctx.write('observed', observed.value);
    ctx.send({ type: 'ObservedInfo', value: observed.value }, 'example.collector');
  }
}

class ProgressObservationNode extends ObservationWorldNode<{ progress: number }> {
  constructor() {
    super('example.watch', 'Watcher', { progress: 0 });
  }

  protected override change(
    info: { readonly type: string; readonly [key: string]: unknown },
    ctx: {
      write(key: string, value: unknown): void;
      send(child: { readonly type: string; readonly [key: string]: unknown }, target: string): void;
    },
  ): void {
    if (info.type !== 'TickInfo') return;
    ctx.write('progress', 100);
    ctx.send({ type: 'ProgressObservedInfo', progress: 100 }, 'example.collector');
  }
}

async function submissionStatus(control: KernelDaemonClient, id: string): Promise<string | undefined> {
  const inspected = await control.agentInspect(0, 1) as {
    submissions: Record<string, { status: string }>;
  };
  return inspected.submissions[id]?.status;
}

async function waitForSubmission(control: KernelDaemonClient, id: string, terminal = ['completed']): Promise<string> {
  // Terminal status (completed/failed/cancelled) is the only settlement proof:
  // it means every write, send and effect of the causal batch has settled.
  for (let round = 0; round < 200; round += 1) {
    const status = await submissionStatus(control, id);
    if (status !== undefined && terminal.includes(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`submission did not settle: ${id}`);
}

describe.skipIf(!existsSync(executable))('P2 daemon fragment lifecycle', () => {
  it('mounts a real cross-Node slice, settles init then start over the daemon', async () => {
    const token = 'p2-fragment-secret-0001';
    const { control, address } = await startDaemon(token);
    const worker = await connectKernelDaemon({ address, token });
    const stop = new AbortController();
    try {
      // Admit on the control plane first: the worker claim below can never
      // hit a missing Node. This admit-then-claim order is the P2 contract.
      const { handlers } = await admitDaemonNodes(control, [new CounterNode(), new CollectorNode()]);
      const running = runDaemonNodeWorker(worker, { handlers, signal: stop.signal, longPollMs: 50 });
      await control.inject('example.counter', { type: 'IncrementInfo' }, 'p2/init/1');
      await waitForSubmission(control, 'p2/init/1');
      await control.inject('example.counter', { type: 'IncrementInfo' }, 'p2/start/1');
      await waitForSubmission(control, 'p2/start/1');
      stop.abort();
      await running;
      const projection = await control.projection();
      expect(projection.nodes['example.counter']).toMatchObject({ state: { count: 2 }, version: 2 });
      expect(projection.nodes['example.collector']).toMatchObject({ state: { seen: 2 } });
      await control.evict('example.counter');
      await control.evict('example.collector');
      expect((await control.shutdown())).toMatchObject({ shutdown: true });
    } finally {
      stop.abort();
      worker.close();
      control.close();
    }
  }, 30_000);

  it('routes a thrown change as @error/NodeFailed and keeps the worker alive', async () => {
    const token = 'p2-error-secret-0001';
    const { control, address } = await startDaemon(token);
    const worker = await connectKernelDaemon({ address, token });
    const errors = await connectKernelDaemon({ address, token });
    const stop = new AbortController();
    try {
      await control.admit('example.errors', { count: 0 });
      await control.setErrorTarget('example.errors');
      const { handlers } = await admitDaemonNodes(control, [new BrokenNode()]);
      const running = runDaemonNodeWorker(worker, { handlers, signal: stop.signal, longPollMs: 50 });
      // A second connection claims the supervisor target, so the error Info
      // is observable as a causal delivery rather than an undrained send.
      await errors.claim(['example.errors']);
      const observing = (async () => {
        for (let round = 0; round < 200; round += 1) {
          const polled = await errors.poll(100);
          if (polled?.change.nodeId === 'example.errors' && polled.change.info.type === '@error/NodeFailed') {
            await errors.commit(polled.change.changeId, []);
            return polled.change.info;
          }
        }
        throw new Error('error Info was not delivered');
      })();
      await control.inject('example.broken', { type: 'RunInfo' }, 'p2/error/1');
      const observed = await observing;
      expect(observed).toMatchObject({ type: '@error/NodeFailed', nodeId: 'example.broken' });
      // fail_change settles the failed change as Completed and routes the
      // failure as @error/NodeFailed with equal circulation rights: the
      // submission completes, the causal fact is observable, nothing hangs.
      stop.abort();
      await running;
      await errors.release(['example.errors']).catch(() => undefined);
      await control.evict('example.broken');
      await control.evict('example.errors');
      expect((await control.shutdown())).toMatchObject({ shutdown: true });
    } finally {
      stop.abort();
      errors.close();
      worker.close();
      control.close();
    }
  }, 30_000);

  it('binds execution and observation WorldNodes to a provider and settles the effect', async () => {
    const token = 'p2-effect-secret-0001';
    const { control, address } = await startDaemon(token);
    const worker = await connectKernelDaemon({ address, token });
    const provider = await connectKernelDaemon({ address, token });
    const workerStop = new AbortController();
    const providerStop = new AbortController();
    try {
      const { handlers } = await admitDaemonNodes(control, [
        new DoublingExecutionNode({ id: 'fixture/double' }),
        new ProgressObservationNode(),
        new CollectorNode(),
      ]);
      const running = runDaemonNodeWorker(worker, {
        handlers, signal: workerStop.signal, longPollMs: 50,
      });
      const providing = runDaemonEffectProvider(provider, {
        signal: providerStop.signal,
        adapters: {
          'fixture/double': (request) => {
            providerStop.abort();
            return { value: Number((request as { value: number }).value) * 2 };
          },
        },
      });
      await control.inject('example.exec', { type: 'RunInfo' }, 'p2/effect/1');
      await waitForSubmission(control, 'p2/effect/1');
      workerStop.abort();
      await Promise.all([running, providing]);
      const projection = await control.projection();
      expect(projection.nodes['example.exec']?.state).toMatchObject({ observed: 42 });
      await control.evict('example.exec');
      await control.evict('example.watch');
      await control.evict('example.collector');
      expect((await control.shutdown())).toMatchObject({ shutdown: true });
    } finally {
      workerStop.abort();
      providerStop.abort();
      provider.close();
      worker.close();
      control.close();
    }
  }, 30_000);
});
