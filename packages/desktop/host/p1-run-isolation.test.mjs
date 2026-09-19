import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRunConfig } from '../../tooling/run/src/config.mjs';
import { acquireRunLock, readActiveRecord, writeActiveRecord } from '../../tooling/run/src/lock.mjs';
import { defaultGeneratedLayout, resolveRunRoot, runBackendOutfile } from '../../tooling/run/src/paths.mjs';

const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function writeConfig(root, name, document = {}) {
  const directory = join(root, name);
  const configPath = join(directory, 'run.config.json');
  const payload = {
    version: 2,
    name,
    plugins: { backend: [{ id: 'example.hello-counter', path: '../../app/plugins/backend/hello-counter' }], frontend: [] },
    kernel: {},
    backend: { dependencies: {} },
    frontend: { instances: [] },
    graph: { instances: [{ kind: 'node', id: 'example.counter', factory: { plugin: 'example.hello-counter', name: 'createCounterNode' } }] },
    lifecycle: { initInfos: [], startInfos: [], stopInfos: [] },
    resources: {},
    ...document,
  };
  return { configPath, runRoot: resolveRunRoot(configPath), document: payload };
}

describe('P1 run configuration and isolation', () => {
  it('parses the same config from another cwd and keeps generated output inside the run root', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p1-config-'));
    temporaryDirectories.push(root);
    for (const name of ['alice', 'spaced name']) {
      mkdirSync(join(root, name, '.generated', 'runtime'), { recursive: true });
      writeFileSync(join(root, name, 'run.config.json'), JSON.stringify(writeConfig(root, name).document));
    }
    const primary = join(root, 'alice', 'run.config.json');
    const runRoot = resolveRunRoot(primary);
    const parsed = parseRunConfig(JSON.parse(readFileSync(primary, 'utf8')), {
      configPath: primary, baseDirectory: runRoot,
    });
    expect(parsed.baseDirectory).toBe(runRoot);
    expect(parsed.resources.generatedDirectory).toBe(join(runRoot, '.generated'));
    const layout = defaultGeneratedLayout(runRoot);
    const outfile = runBackendOutfile(layout, 'demo.topology', 'backend.ts');
    expect(outfile.startsWith(layout.backend)).toBe(true);
    expect(outfile).not.toContain(resolve('app/plugins'));
    const spaced = join(root, 'spaced name', 'run.config.json');
    const spacedRoot = resolveRunRoot(spaced);
    const parsedSpaced = parseRunConfig(JSON.parse(readFileSync(spaced, 'utf8')), {
      configPath: spaced, baseDirectory: spacedRoot,
    });
    expect(parsedSpaced.baseDirectory).toBe(spacedRoot);
  });

  it('fails illegal configs before taking any resource', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p1-invalid-'));
    temporaryDirectories.push(root);
    const versioned = writeConfig(root, 'bad', { version: 99 });
    expect(() => parseRunConfig(versioned.document, {
      configPath: versioned.configPath, baseDirectory: versioned.runRoot,
    })).toThrow('unsupported version');
    const duplicated = writeConfig(root, 'dup', {
      graph: { instances: [{ kind: 'node', id: 'example.counter', factory: { plugin: 'example.hello-counter', name: 'createCounterNode' } }, { kind: 'node', id: 'example.counter', factory: { plugin: 'example.hello-counter', name: 'createCounterNode' } }] },
    });
    expect(() => parseRunConfig(duplicated.document, {
      configPath: duplicated.configPath, baseDirectory: duplicated.runRoot,
    })).toThrow('duplicate graph instance');
    const missing = writeConfig(root, 'missing', {
      lifecycle: { startInfos: [{ targetNodeId: 'example.counter', info: { kind: 'IncrementInfo' } }] },
    });
    expect(() => parseRunConfig(missing.document, {
      configPath: missing.configPath, baseDirectory: missing.runRoot,
    })).toThrow('info.type');
    const badEntry = writeConfig(root, 'entry', {
      frontend: { instances: [{ id: 'bad', plugin: 'nope', graph: null, entry: '/absolute/backend.mjs' }] },
    });
    expect(() => parseRunConfig(badEntry.document, {
      configPath: badEntry.configPath, baseDirectory: badEntry.runRoot,
    })).toThrow('not a declared frontend plugin');
  });

  it('builds two arbitrary runs in parallel without cross-writing sources or caches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p1-parallel-'));
    temporaryDirectories.push(root);
    const first = writeConfig(root, 'alice');
    const second = writeConfig(root, 'task-42');
    const firstLayout = defaultGeneratedLayout(first.runRoot);
    const secondLayout = defaultGeneratedLayout(second.runRoot);
    expect(firstLayout.backend).not.toBe(secondLayout.backend);
    const entries = [];
    for (const layout of [firstLayout, secondLayout]) {
      mkdirSync(layout.backend, { recursive: true });
      const entry = join(layout.backend, 'entry.mjs');
      writeFileSync(entry, 'export const marker = 1;\n');
      entries.push(entry);
    }
    const outputs = await Promise.all(entries.map(async (entry, index) => {
      const layout = index === 0 ? firstLayout : secondLayout;
      const outfile = join(layout.backend, 'bundle.js');
      await build({
        entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
      });
      return outfile;
    }));
    expect(outputs[0]).not.toBe(outputs[1]);
    expect(existsSync(resolve('app/plugins/backend/hello-counter', 'bundle.js'))).toBe(false);
  });

  it('locks one active run per name and keeps stop on the activity snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p1-lock-'));
    temporaryDirectories.push(root);
    const parsed = writeConfig(root, 'alice');
    const runtime = join(parsed.runRoot, '.generated', 'runtime');
    mkdirSync(runtime, { recursive: true });
    const holder = acquireRunLock(runtime, { runName: 'alice', pid: process.pid });
    expect(() => acquireRunLock(runtime, { runName: 'alice', pid: process.pid })).toThrow('already active');
    writeActiveRecord(runtime, { runName: 'alice', pid: process.pid, configPath: parsed.configPath });
    expect(readActiveRecord(runtime)).toMatchObject({ runName: 'alice', pid: process.pid });
    holder.release();
  });
});
