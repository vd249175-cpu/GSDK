import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRunConfig, startRun, statusRun, stopRun } from '../../tooling/run/src/lifecycle.mjs';

const daemonExe = process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon';

const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeRun(root, name, document = {}) {
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

describe('P3 run start/stop/status records', () => {
  it('starts an empty kernel, records identity, and stops idempotently', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p3-lifecycle-'));
    temporaryRoots.push(root);
    const configPath = writeRun(root, 'alice');
    const handle = await startRun(configPath);
    try {
      expect(handle.snapshot.kernel.address).toMatch(/^127\.0\.0\.1:\d+$/);
      expect(handle.snapshot.kernel.pid).toBeGreaterThan(0);
      expect(handle.snapshot.stages).toEqual(['validate', 'lock', 'kernel-ready']);
      // Credential lives in the run's generated dir, never in the config.
      expect(existsSync(join(handle.parsed.resources.runtimeDirectory, 'daemon-token'))).toBe(true);
      expect(readFileSync(configPath, 'utf8')).not.toContain('daemon-token');
      const status = statusRun(configPath);
      expect(status).toMatchObject({ active: true, runName: 'alice', pid: process.pid });
      // Same-name start while active is rejected without touching the kernel.
      await expect(startRun(configPath)).rejects.toThrow('already active');
    } finally {
      handle.stopKernel();
    }
    expect(stopRun(configPath)).toMatchObject({ stopped: true, already: false, runName: 'alice' });
    handle.releaseLock();
    expect(stopRun(configPath)).toMatchObject({ stopped: true, already: true });
    expect(statusRun(configPath)).toMatchObject({ active: false, runName: 'alice' });
  });

  it('rejects invalid configs before taking the lock or spawning a kernel', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p3-invalid-'));
    temporaryRoots.push(root);
    const configPath = writeRun(root, 'bad', { version: 99 });
    await expect(startRun(configPath)).rejects.toThrow('unsupported version');
    expect(statusRun(configPath)).toMatchObject({ active: false });
  });

  it('keeps stop on the activity snapshot when the live config changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p3-snapshot-'));
    temporaryRoots.push(root);
    const configPath = writeRun(root, 'alice');
    const handle = await startRun(configPath);
    try {
      const parsed = loadRunConfig(configPath);
      expect(parsed.runName).toBe('alice');
      // Rewrite the live config mid-run: stop must still target the snapshot.
      const rewritten = { ...JSON.parse(readFileSync(configPath, 'utf8')), name: 'mallory' };
      writeFileSync(configPath, JSON.stringify(rewritten, null, 2));
      const stopped = stopRun(configPath);
      expect(stopped).toMatchObject({ stopped: true, runName: 'alice' });
    } finally {
      handle.stopKernel();
      handle.releaseLock();
    }
  });

  it('statuses two arbitrary runs independently', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p3-parallel-'));
    temporaryRoots.push(root);
    const first = writeRun(root, 'alice');
    const second = writeRun(root, 'task-42');
    const a = await startRun(first);
    const b = await startRun(second);
    try {
      expect(statusRun(first)).toMatchObject({ active: true, runName: 'alice' });
      expect(statusRun(second)).toMatchObject({ active: true, runName: 'task-42' });
      expect(a.snapshot.kernel.address).not.toBe(b.snapshot.kernel.address);
      expect(stopRun(first)).toMatchObject({ stopped: true, runName: 'alice' });
      expect(statusRun(second)).toMatchObject({ active: true, runName: 'task-42' });
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
