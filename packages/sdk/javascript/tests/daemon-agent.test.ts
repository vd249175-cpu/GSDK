import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterEach, describe, expect, it } from 'vitest';
import { connectKernelDaemon } from '../src/agent/daemon-client';
import { runDaemonNodeWorker } from '../src/node/daemon-node';

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
  const token = 'fixture-secret-0002';
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

/** Read one field off an unvalidated daemon DTO. */
function field(value: unknown, key: string): unknown {
  if (typeof value === 'object' && value !== null && key in value) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}

function counterFacts() {
  return {
    version: 1 as const,
    nodeId: 'counter',
    entities: [
      { address: 'node:counter', kind: 'node', id: 'counter' },
      { address: 'change:counter::IncrementInfo', kind: 'change', id: 'counter', nodeId: 'counter', subId: 'IncrementInfo' },
      { address: 'state:counter::count', kind: 'state', id: 'counter', nodeId: 'counter', subId: 'count' },
      { address: 'info:IncrementInfo@counter', kind: 'info', id: 'IncrementInfo', nodeId: 'counter', subId: 'counter' },
    ],
    edges: [
      { id: 'tick', from: 'change:counter::IncrementInfo', to: 'info:IncrementInfo@counter', type: 'send', confidence: 'high' },
      { id: 'tick-write', from: 'change:counter::IncrementInfo', to: 'state:counter::count', type: 'write', confidence: 'high' },
    ],
  };
}

describe.skipIf(!existsSync(executable))('Rust daemon analysis and Agent control plane', () => {
  it('serves entity/path/view queries and Agent inspect/inject/intervene over DTOs', async () => {
    const daemon = await startDaemon();
    const control = await connectKernelDaemon(daemon);
    const worker = await connectKernelDaemon(daemon);
    const stop = new AbortController();
    try {
      await control.admit('counter', { count: 0 }, counterFacts());
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

      const injected: unknown = await control.agentInject(
        'agent/test', 'probe', 'agent/1', 'counter', { type: 'IncrementInfo' },
      );
      expect(field(injected, 'duplicate')).toBe(false);
      expect(field(field(injected, 'feedback'), 'status')).toBe('enqueued');
      await running;

      const replay: unknown = await control.agentInject(
        'agent/test', 'probe', 'agent/1', 'counter', { type: 'IncrementInfo' },
      );
      expect(field(replay, 'duplicate')).toBe(true);
      await expect(control.agentInject(
        'agent/test', 'probe', 'agent/1', 'counter', { type: 'OtherInfo' },
      )).rejects.toThrow();

      const view: unknown = await control.analyze({ op: 'view' });
      const routes = field(view, 'routes');
      expect(Array.isArray(routes) ? routes.map((route) => field(route, 'id')) : []).toEqual([
        'route:counter->counter:IncrementInfo',
      ]);
      const entity: unknown = await control.analyze({ op: 'entity', address: 'node:counter' });
      expect(field(entity, 'id')).toBe('counter');
      const path: unknown = await control.analyze({ op: 'path', addresses: ['node:counter', 'state:counter::count'] });
      expect(field(path, 'connected')).toBe(true);
      const health: unknown = await control.analyze({ op: 'health' });
      expect(field(health, 'nodeCount')).toBe(1);
      const folded: unknown = await control.analyze({
        op: 'view', foldDepth: 0,
        folds: { version: 1, root: 'world', groups: { world: { children: ['counter'] } } },
      });
      const foldedNodes = field(folded, 'nodes');
      expect(typeof foldedNodes === 'object' && foldedNodes !== null ? Object.keys(foldedNodes) : []).toEqual(['fold:world']);

      const before: unknown = await control.agentInspect();
      const beforeRevision = field(field(before, 'projection'), 'analysisRevision');
      await control.setAnalysisContext([], []);
      const afterContext: unknown = await control.agentInspect();
      expect(field(field(afterContext, 'projection'), 'analysisRevision')).toBe((beforeRevision as number) + 1);

      const patched: unknown = await control.agentInterveneState(
        'agent/test', 'repair', 'counter', { count: 42 }, 0, 1,
      );
      expect(field(patched, 'version')).toBe(2);
      expect(field(patched, 'state')).toEqual({ count: 42 });
      await expect(control.agentInterveneState(
        'agent/test', 'repair', 'counter', { count: 43 }, 0, 1,
      )).rejects.toThrow();

      const inspect: unknown = await control.agentInspect(0, 100);
      const nodes = field(field(inspect, 'projection'), 'nodes');
      const counter = typeof nodes === 'object' && nodes !== null
        ? (nodes as Record<string, unknown>)['counter']
        : undefined;
      expect(field(counter, 'state')).toEqual({ count: 42 });
      expect(field(inspect, 'activeChanges')).toEqual([]);
      const events = field(inspect, 'events');
      expect(field(events, 'truncated')).toBe(false);
      const eventList = field(events, 'events');
      expect(Array.isArray(eventList) ? eventList.length : 0).toBeGreaterThan(0);
      const kinds = Array.isArray(eventList) ? eventList.map((event) => field(event, 'kind')) : [];
      expect(kinds).toContain('state_intervened');

      await control.replace('counter', { count: 0 });
      const facts: unknown = await control.analysisFacts();
      expect(field(facts, 'nodes')).toEqual({});
      const cleared: unknown = await control.analyze({ op: 'view' });
      expect(field(cleared, 'routes')).toEqual([]);
    } finally {
      worker.close();
      control.close();
    }
  });

  it.skipIf(!pythonAvailable)('runs a Python Node from an arbitrary directory and queries its facts', async () => {
    const daemon = await startDaemon();
    const control = await connectKernelDaemon(daemon);
    const checkout = mkdtempSync(join(tmpdir(), 'graphvideo-agent-python-'));
    temporaryDirectories.push(checkout);
    copyFileSync(portablePythonNode, join(checkout, 'worker.py'));
    const facts = {
      version: 1 as const,
      nodeId: 'portable.python',
      entities: [
        { address: 'node:portable.python', kind: 'node', id: 'portable.python' },
        { address: 'change:portable.python::RunInfo', kind: 'change', id: 'portable.python', nodeId: 'portable.python', subId: 'RunInfo' },
        { address: 'state:portable.python::runs', kind: 'state', id: 'portable.python', nodeId: 'portable.python', subId: 'runs' },
      ],
      edges: [
        { id: 'run-write', from: 'change:portable.python::RunInfo', to: 'state:portable.python::runs', type: 'write', confidence: 'high' },
      ],
    };
    // Facts travel with the Node: authored next to the Python source, stored
    // by Rust at admit, queried without ever parsing Python.
    writeFileSync(join(checkout, 'analysis-facts.json'), JSON.stringify(facts));
    try {
      await control.admit('portable.python', { runs: 0 }, facts);
      const worker = spawn('python', ['-u', 'worker.py'], {
        cwd: checkout,
        env: { ...process.env, GRAPHVIDEO_DAEMON_ADDRESS: daemon.address, GRAPHVIDEO_DAEMON_TOKEN: daemon.token },
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
      await control.agentInject('agent/test', 'run', 'agent/py/1', 'portable.python', { type: 'RunInfo' });
      await exited;
      const projection: unknown = await control.projection();
      const projected = field(field(projection, 'nodes'), 'portable.python');
      expect(field(projected, 'state')).toEqual({ runs: 1 });

      const entity: unknown = await control.analyze({ op: 'entity', address: 'node:portable.python' });
      expect(field(entity, 'id')).toBe('portable.python');
      const path: unknown = await control.analyze({
        op: 'path', addresses: ['change:portable.python::RunInfo', 'state:portable.python::runs'],
      });
      expect(field(path, 'connected')).toBe(true);
      const view: unknown = await control.analyze({ op: 'view' });
      const viewNodes = field(view, 'nodes');
      expect(typeof viewNodes === 'object' && viewNodes !== null ? Object.keys(viewNodes) : []).toContain('portable.python');
      const folded: unknown = await control.analyze({
        op: 'view', foldDepth: 1,
        folds: { version: 1, root: 'world', groups: { world: { children: ['portable.python'] } } },
      });
      const foldedNodes = field(folded, 'nodes');
      expect(typeof foldedNodes === 'object' && foldedNodes !== null ? Object.keys(foldedNodes) : []).toEqual(['portable.python']);
    } finally {
      control.close();
    }
  });
});
