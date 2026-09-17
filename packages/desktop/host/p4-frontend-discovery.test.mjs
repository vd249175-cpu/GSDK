import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRunRendererRoot, readRunDiscovery, writeRunDiscovery } from '../../tooling/run/src/discovery.mjs';
import { startRun, stopRun } from '../../tooling/run/src/lifecycle.mjs';

const daemonExe = process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon';
const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeRunConfig(root, name, document = {}) {
  const directory = join(root, name);
  mkdirSync(join(directory, '.generated', 'runtime'), { recursive: true });
  const payload = {
    version: 1,
    name,
    plugins: [],
    kernel: { bind: '127.0.0.1:0', daemonPath: resolve('packages/rust/target/debug', daemonExe) },
    backend: {},
    frontend: { enabled: false },
    graph: { instances: [] },
    lifecycle: { initInfos: [], startInfos: [], stopInfos: [] },
    resources: {},
    ...document,
  };
  const configPath = join(directory, 'run.config.json');
  writeFileSync(configPath, JSON.stringify(payload, null, 2));
  return configPath;
}

describe('P4 run frontend discovery and command binding', () => {
  it('writes a run-scoped discovery document instead of the user-level one', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p4-discovery-'));
    temporaryRoots.push(root);
    const runtime = join(root, 'alice', '.generated', 'runtime');
    const path = writeRunDiscovery(runtime, {
      runName: 'alice',
      kernel: { address: '127.0.0.1:52143', pid: 1234 },
      agentControl: { discoveryPath: join(runtime, 'agent-control.json') },
    });
    expect(path).toBe(join(runtime, 'frontend-discovery.json'));
    expect(readRunDiscovery(runtime)).toMatchObject({
      version: 1,
      runName: 'alice',
      kernel: { address: '127.0.0.1:52143', pid: 1234 },
    });
    expect(readFileSync(path, 'utf8')).not.toContain('.graphvideo');
  });

  it('rejects discovery without a kernel endpoint', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p4-discovery-invalid-'));
    temporaryRoots.push(root);
    expect(() => writeRunDiscovery(join(root, 'runtime'), { runName: 'alice', kernel: {} }))
      .toThrow('kernel address');
  });

  it('gates renderer commands to the actually assembled roots', () => {
    const assembled = [{
      targetNodeId: 'example.counter',
      infoType: 'IncrementInfo',
      validate: (info) => info?.type === 'IncrementInfo',
    }];
    expect(() => assertRunRendererRoot(assembled, {
      targetNodeId: 'example.counter', info: { type: 'IncrementInfo' },
    })).not.toThrow();
    expect(() => assertRunRendererRoot(assembled, {
      targetNodeId: 'example.counter', info: { type: 'ResetInfo' },
    })).toThrow('not assembled');
    expect(() => assertRunRendererRoot([], {
      targetNodeId: 'example.counter', info: { type: 'IncrementInfo' },
    })).toThrow('not assembled');
  });

  it('keeps two frontend runs on separate discovery documents', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p4-parallel-'));
    temporaryRoots.push(root);
    const first = writeRunDiscovery(join(root, 'alice', '.generated', 'runtime'), {
      runName: 'alice',
      kernel: { address: '127.0.0.1:52143', pid: 1 },
      agentControl: { discoveryPath: join(root, 'alice', '.generated', 'runtime', 'agent-control.json') },
      frontend: { enabled: true, userDataPath: join(root, 'alice', '.generated', 'frontend', 'alice', 'electron-user-data') },
    });
    const second = writeRunDiscovery(join(root, 'task-42', '.generated', 'runtime'), {
      runName: 'task-42',
      kernel: { address: '127.0.0.1:52144', pid: 2 },
      agentControl: { discoveryPath: join(root, 'task-42', '.generated', 'runtime', 'agent-control.json') },
      frontend: { enabled: true, userDataPath: join(root, 'task-42', '.generated', 'frontend', 'task-42', 'electron-user-data') },
    });
    expect(first).not.toBe(second);
    const aliceDiscovery = readRunDiscovery(join(root, 'alice', '.generated', 'runtime'));
    const otherDiscovery = readRunDiscovery(join(root, 'task-42', '.generated', 'runtime'));
    expect(aliceDiscovery.kernel.address).not.toBe(otherDiscovery.kernel.address);
    expect(aliceDiscovery.frontend.userDataPath).not.toBe(otherDiscovery.frontend.userDataPath);
    expect(aliceDiscovery.agentControl.discoveryPath).not.toBe(otherDiscovery.agentControl.discoveryPath);
    writeFileSync(join(root, 'marker.txt'), 'parallel');
  });

  it('leaves no-frontend fragments without Electron isolation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p4-nofrontend-'));
    temporaryRoots.push(root);
    const configPath = writeRunConfig(root, 'alice');
    const handle = await startRun(configPath);
    try {
      expect(handle.snapshot.frontend).toMatchObject({ enabled: false });
      expect(readRunDiscovery(handle.parsed.resources.runtimeDirectory).frontend).toBeNull();
      expect(existsSync(join(handle.parsed.baseDirectory, '.generated', 'frontend'))).toBe(false);
    } finally {
      handle.stopKernel();
      handle.releaseLock();
    }
  });

  it('runs two frontend runs in parallel without sharing endpoints or roots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p4-dual-'));
    temporaryRoots.push(root);
    const first = writeRunConfig(root, 'alice', { frontend: { enabled: true } });
    const second = writeRunConfig(root, 'task-42', { frontend: { enabled: true } });
    const a = await startRun(first);
    const b = await startRun(second);
    try {
      expect(a.snapshot.kernel.address).not.toBe(b.snapshot.kernel.address);
      expect(a.snapshot.frontend.userDataPath).not.toBe(b.snapshot.frontend.userDataPath);
      expect(a.snapshot.frontend.agentControlPath).not.toBe(b.snapshot.frontend.agentControlPath);
      const aliceDiscovery = readRunDiscovery(a.parsed.resources.runtimeDirectory);
      const otherDiscovery = readRunDiscovery(b.parsed.resources.runtimeDirectory);
      expect(aliceDiscovery.kernel.address).toBe(a.snapshot.kernel.address);
      expect(otherDiscovery.kernel.address).toBe(b.snapshot.kernel.address);
      expect(aliceDiscovery.frontend.userDataPath).toBe(a.snapshot.frontend.userDataPath);
      expect(otherDiscovery.frontend.userDataPath).toBe(b.snapshot.frontend.userDataPath);
      // Renderer command gate in run A only knows A's assembled roots.
      const assembledA = [{ targetNodeId: 'example.counter', infoType: 'IncrementInfo' }];
      expect(() => assertRunRendererRoot(assembledA, {
        targetNodeId: 'example.counter', info: { type: 'IncrementInfo' },
      })).not.toThrow();
      expect(() => assertRunRendererRoot([], {
        targetNodeId: 'example.counter', info: { type: 'IncrementInfo' },
      })).toThrow('not assembled');
      // Closing A leaves B active on its own endpoint and roots.
      expect(stopRun(first)).toMatchObject({ stopped: true, runName: 'alice' });
      expect(readRunDiscovery(b.parsed.resources.runtimeDirectory).kernel.address).toBe(b.snapshot.kernel.address);
    } finally {
      a.stopKernel();
      a.releaseLock();
      b.stopKernel();
      b.releaseLock();
      stopRun(first);
      stopRun(second);
    }
  });
});
