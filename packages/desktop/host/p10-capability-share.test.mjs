import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { installCapability, packCapability, verifyCapability } from '../../tooling/run/src/package.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const temporaryRoots = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeSource(root, { capabilityId = 'example.counter-cap', version = '1.0.0', pluginId = 'example.counter-cap-plugin' } = {}) {
  const dir = join(root, `${capabilityId}-${version}`);
  const pluginDir = join(dir, 'plugins', 'backend', 'example.counter');
  mkdirSync(join(pluginDir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'graphframework.capability.json'), JSON.stringify({
    id: capabilityId, version, summary: 'fixture', workflow: 'docs:fixture',
  }, null, 2));
  writeFileSync(join(dir, 'assembly.mjs'), `export default {
  id: ${JSON.stringify(capabilityId)},
  contribute(run) {
    run.backendPlugin({ id: ${JSON.stringify(pluginId)}, path: './plugins/backend/example.counter' });
    run.node({ id: 'cap.counter', plugin: ${JSON.stringify(pluginId)}, factory: 'createCounterNode' });
    run.requireNode('cap.counter');
  },
};
`);
  writeFileSync(join(pluginDir, 'graphframework.plugin.json'), JSON.stringify({
    id: pluginId, name: 'Counter', version: '1.0.0', apiVersion: 2, kind: 'backend',
    contributes: { backend: 'index.mjs', nodeFactories: ['createCounterNode'], graphFactories: [] },
  }, null, 2));
  writeFileSync(join(pluginDir, 'index.mjs'), `export const createCounterNode = () => ({ id: 'cap.counter' });\n`);
  writeFileSync(join(pluginDir, 'PACKAGE.md'), `---\ntype: package\npackage_id: ${pluginId}\npackage_version: 1.0.0\n---\n`);
  writeFileSync(join(pluginDir, 'docs', 'INTEGRATION.md'), `# fixture\n`);
  return dir;
}

function writeRun(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const document = {
    version: 2, name, assembly: { modules: ['assembly.mjs'] },
    plugins: { backend: [], frontend: [] },
    kernel: { bind: '127.0.0.1:0', daemonPath: join(repoRoot, 'packages', 'rust', 'target', 'debug', process.platform === 'win32' ? 'graphframework-kernel-daemon.exe' : 'graphframework-kernel-daemon') },
    backend: { dependencies: {} }, frontend: { instances: [] }, graph: { instances: [] },
    lifecycle: { initInfos: [], startInfos: [], stopInfos: [] }, scenarios: null, resources: {},
  };
  writeFileSync(join(dir, 'run.config.json'), JSON.stringify(document, null, 2));
  writeFileSync(join(dir, 'assembly.mjs'), `export default { id: 'empty-run', contribute() {} };\n`);
  return join(dir, 'run.config.json');
}

describe('P10 capability pack/verify/install across directories', () => {
  it('packs deterministically: same source twice yields identical sha256', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p10-determinism-'));
    temporaryRoots.push(root);
    const source = writeSource(root);
    const first = await packCapability(source, join(root, 'example.counter-cap-1.0.0.zip'));
    const second = await packCapability(source, join(root, 'out', 'example.counter-cap-1.0.0.zip'));
    expect(first.sha256).toBe(second.sha256);
    expect(first.zip.endsWith('example.counter-cap-1.0.0.zip')).toBe(true);
    expect(existsSync(`${first.zip}.sha256`)).toBe(true);
  });

  it('verifies shape and reports sha mismatch without trusting chat metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p10-verify-'));
    temporaryRoots.push(root);
    const packed = await packCapability(writeSource(root), join(root, 'example.counter-cap-1.0.0.zip'));
    const good = await verifyCapability(packed.zip);
    expect(good.ok).toBe(true);
    expect(good.capability).toMatchObject({ id: 'example.counter-cap', version: '1.0.0' });
    const bad = await verifyCapability(packed.zip, { expectSha256: 'deadbeef' });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join('\n')).toContain('SHA-256 mismatch');
  });

  it('rejects forbidden payloads before zipping', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p10-forbidden-'));
    temporaryRoots.push(root);
    const source = writeSource(root);
    mkdirSync(join(source, 'node_modules', 'evil'), { recursive: true });
    writeFileSync(join(source, 'node_modules', 'evil', 'x.js'), 'evil');
    await expect(packCapability(source, join(root, 'example.counter-cap-1.0.0.zip'))).rejects.toThrow('node_modules');
  });
  it('installs a foreign zip into an unrelated directory and validates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p10-install-'));
    temporaryRoots.push(root);
    const packed = await packCapability(writeSource(root), join(root, 'example.counter-cap-1.0.0.zip'));
    const configPath = writeRun(root, 'bob');
    const installed = await installCapability(packed.zip, { runConfigPath: configPath });
    expect(installed.assemblyModule).toBe('capabilities/example.counter-cap/assembly.mjs');
    const document = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(document.assembly.modules).toEqual(['assembly.mjs', 'capabilities/example.counter-cap/assembly.mjs']);
    const { loadRunConfig, resolveDaemonBinary } = await import('../../tooling/run/src/lifecycle.mjs');
    const { resolveRunAssembly } = await import('../../tooling/run/src/assembly.mjs');
    resolveDaemonBinary(await resolveRunAssembly(loadRunConfig(configPath)));
  });

  it('refuses to overwrite a locally edited capability without hiding the edit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p10-conflict-'));
    temporaryRoots.push(root);
    const packed = await packCapability(writeSource(root), join(root, 'example.counter-cap-1.0.0.zip'));
    const configPath = writeRun(root, 'alice');
    const before = readFileSync(configPath, 'utf8');
    await installCapability(packed.zip, { dir: join(root, 'alice', 'capabilities') });
    const clashDir = join(root, 'alice', 'capabilities', 'example.counter-cap');
    writeFileSync(join(clashDir, 'assembly.mjs'), readFileSync(join(clashDir, 'assembly.mjs'), 'utf8').replaceAll('cap.counter', 'alice-clash'));
    await expect(installCapability(packed.zip, { runConfigPath: configPath, update: true })).rejects.toThrow('local edits');
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('reports two capabilities claiming the same Node ID with both definitions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p10-clash-'));
    temporaryRoots.push(root);
    const first = await packCapability(writeSource(root, { capabilityId: 'example.counter-cap', pluginId: 'example.counter-cap-plugin' }), join(root, 'example.counter-cap-1.0.0.zip'));
    const second = await packCapability(writeSource(root, { capabilityId: 'example.other-cap', pluginId: 'example.other-cap-plugin' }), join(root, 'example.other-cap-1.0.0.zip'));
    const configPath = writeRun(root, 'dave');
    await installCapability(first.zip, { runConfigPath: configPath });
    const before = readFileSync(configPath, 'utf8');
    await expect(installCapability(second.zip, { runConfigPath: configPath })).rejects.toThrow('conflicting graph instance: cap.counter');
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('updates the same capability in place without duplicating assembly modules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-p10-update-'));
    temporaryRoots.push(root);
    const first = await packCapability(writeSource(root, { version: '1.0.0' }), join(root, 'example.counter-cap-1.0.0.zip'));
    const configPath = writeRun(root, 'carol');
    await installCapability(first.zip, { runConfigPath: configPath });
    const second = await packCapability(writeSource(root, { version: '1.0.1' }), join(root, 'out', 'example.counter-cap-1.0.1.zip'));
    const updated = await installCapability(second.zip, { runConfigPath: configPath, update: true });
    expect(updated.updated).toBe(true);
    expect(updated.capability.version).toBe('1.0.1');
    const document = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(document.assembly.modules).toEqual(['assembly.mjs', 'capabilities/example.counter-cap/assembly.mjs']);
  });
});
