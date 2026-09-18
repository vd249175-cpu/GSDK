import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { statusRun } from '../../tooling/run/src/lifecycle.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const daemonExe = process.platform === 'win32' ? 'graphvideo-kernel-daemon.exe' : 'graphvideo-kernel-daemon';
const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeRun(root, name) {
  const directory = join(root, name);
  mkdirSync(join(directory, '.generated', 'runtime'), { recursive: true });
  const payload = {
    version: 1,
    name,
    plugins: [],
    kernel: { bind: '127.0.0.1:0', daemonPath: join(repoRoot, 'packages', 'rust', 'target', 'debug', daemonExe) },
    backend: {},
    frontend: { enabled: false },
    graph: { instances: [] },
    lifecycle: { initInfos: [], startInfos: [], stopInfos: [] },
    resources: {},
  };
  const configPath = join(directory, 'run.config.json');
  writeFileSync(configPath, JSON.stringify(payload, null, 2));
  return configPath;
}

function sh(op, configPath) {
  const out = execFileSync('bash', ['./run.sh', op, configPath], {
    cwd: repoRoot, timeout: 90_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

describe('P9 bash symmetric lifecycle', () => {
  it('keeps the run active after start and closes it on stop', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p9-lifecycle-'));
    temporaryRoots.push(root);
    const configPath = writeRun(root, 'alice');
    const started = sh('start', configPath);
    expect(started.started).toBe(true);
    try {
      // Supervisor start leaves the run active (red in the P3 slice: start
      // boots the kernel, then kills it and releases the lock on return).
      expect(statusRun(configPath)).toMatchObject({ active: true, runName: 'alice' });
      const stopped = sh('stop', configPath);
      expect(stopped).toMatchObject({ stopped: true, already: false });
      expect(statusRun(configPath)).toMatchObject({ active: false });
    } finally {
      try { sh('stop', configPath); } catch { /* already closed */ }
    }
  });
});
