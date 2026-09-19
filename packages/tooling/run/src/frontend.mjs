import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { readSnapshot, runtimeFor, sleep, repoRoot, updateSession } from './session.mjs';
import { resolveEntry } from './assembly.mjs';
import { callRunControl } from './control.mjs';

const desktop = join(repoRoot, 'packages/desktop');
const quote = (value) => `'${String(value).replaceAll("'", "'\"'\"'")}'`;

/** Build only the configured frontend entries into this run's writable tree. */
export async function buildRunFrontends(config) {
  const { parsed, runId } = readSnapshot(config);
  const require = createRequire(join(desktop, 'package.json'));
  const esbuild = require('esbuild');
  const vite = await import(new URL('../../../desktop/node_modules/vite/dist/node/index.js', import.meta.url));
  const react = require('@vitejs/plugin-react');
  const entries = [];
  for (const instance of parsed.frontend.instances) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(instance.id)) throw new Error(`Invalid frontend identity: ${instance.id}`);
    const plugin = parsed.plugins.frontend.find((entry) => entry.id === instance.plugin);
    if (!plugin) throw new Error(`Frontend plugin not found: ${instance.plugin}`);
    const manifestFile = existsSync(join(plugin.directory, 'graphframework.plugin.json')) ? 'graphframework.plugin.json' : 'graphvideo.plugin.json';
    const manifest = JSON.parse(readFileSync(join(plugin.directory, manifestFile), 'utf8'));
    if (manifest.id !== plugin.id || manifest.apiVersion !== 2 || manifest.kind !== 'frontend') throw new Error(`Invalid frontend manifest: ${plugin.id}`);
    const host = resolveEntry(plugin.directory, manifest.contributes?.host);
    const renderer = resolveEntry(plugin.directory, instance.entry ?? manifest.contributes?.frontend);
    const output = join(parsed.resources.generatedDirectory, 'frontend', instance.id);
    mkdirSync(output, { recursive: true });
    const html = join(output, 'index.html');
    const definition = { name: manifest.name, plugins: parsed.plugins.frontend.map((entry) => ({ id: entry.id, path: entry.directory })), defaultWorkspace: 'editing', defaultTheme: 'dark' };
    const elementEntries = parsed.plugins.frontend.flatMap((entry) => {
      const docFile = existsSync(join(entry.directory, 'graphframework.plugin.json')) ? 'graphframework.plugin.json' : 'graphvideo.plugin.json';
      const document = JSON.parse(readFileSync(join(entry.directory, docFile), 'utf8'));
      return (document.contributes?.elements ?? []).map((element) => `${JSON.stringify(`${entry.id}/${element}`)}:()=>import(${JSON.stringify(join(entry.directory, 'elements', element, 'element.ts').replaceAll('\\', '/'))})`);
    });
    writeFileSync(html, '<!doctype html><html><head><meta charset="UTF-8"><title>GraphFramework</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
    const alias = {
      '@graphframework/sdk/protocol': join(repoRoot, 'packages/sdk/javascript/src/protocol/index.ts'),
      react: join(desktop, 'node_modules/react'), 'react-dom': join(desktop, 'node_modules/react-dom'),
      'lucide-react': join(desktop, 'node_modules/lucide-react/dist/esm/lucide-react.mjs'),
      yaml: join(desktop, 'node_modules/yaml/browser/index.js'),
      '@graphframework/workbench': join(repoRoot, 'packages/frontend/workbench/src'),
      '@graphframework/client': join(repoRoot, 'packages/frontend/client'),
      '@graphframework/context': join(repoRoot, 'packages/frontend/context'),
      '@graphframework/ui': join(repoRoot, 'packages/frontend/ui'),
      '@graphframework/theme': join(repoRoot, 'packages/frontend/theme'),
    };
    await vite.build({ configFile: false, root: output, base: './', cacheDir: join(output, 'cache'), resolve: { alias },
      plugins: [react.default?.() ?? react(), { name: 'run-entry',
        resolveId: (id) => id === '/entry.tsx' ? '\0run-entry' : ['virtual:graphframework-config', 'virtual:graphframework-elements'].includes(id) ? `\0${id}` : undefined,
        load: (id) => id === '\0run-entry' ? `import ${JSON.stringify(renderer.replaceAll('\\', '/'))};` : id === '\0virtual:graphframework-config' ? `export const applicationDefinition=${JSON.stringify(definition)};` : id === '\0virtual:graphframework-elements' ? `export const elementModules={${elementEntries.join(',')}};` : undefined }],
      build: { outDir: join(output, 'dist'), emptyOutDir: true }, logLevel: 'error' });
    const hostFile = join(output, 'host.mjs');
    const sdkAlias = Object.fromEntries(['protocol', 'node', 'effect', 'plugin', 'analysis', 'agent'].map((name) => [`@graphframework/sdk/${name}`, join(repoRoot, `packages/sdk/javascript/src/${name}/index.ts`)]));
    sdkAlias['@graphframework/desktop/command-gate'] = join(desktop, 'host/services/command-gate.mjs');
    sdkAlias.yaml = join(desktop, 'node_modules/yaml/browser/index.js');
    await esbuild.build({ entryPoints: [host], outfile: hostFile, bundle: true, format: 'esm', platform: 'node',
      alias: { ...sdkAlias, '@graphframework/desktop/electron-window': join(desktop, 'host/effects/electron-window-adapter.mjs'),
        '@graphframework/desktop/element-catalog': join(desktop, 'host/services/element-catalog.mjs') }, external: ['electron', '*.node', 'typescript'], logLevel: 'silent' });
    const context = { runId, configPath: parsed.configPath, runtimeDirectory: runtimeFor(config), instance,
      pluginDirectory: plugin.directory, rendererFile: join(output, 'dist/index.html'), userDataDirectory: join(output, 'user-data'),
      definition };
    writeFileSync(join(output, 'context.json'), JSON.stringify(context));
    entries.push({ id: instance.id, entry: hostFile, context: join(output, 'context.json') });
  }
  const electron = join(desktop, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  writeFileSync(join(runtimeFor(config), 'frontends.sh'), `ELECTRON_BINARY=${quote(electron)}\nFRONTEND_IDS=(${entries.map((entry) => quote(entry.id)).join(' ')})\nFRONTEND_ENTRIES=(${entries.map((entry) => quote(entry.entry)).join(' ')})\nFRONTEND_CONTEXTS=(${entries.map((entry) => quote(entry.context)).join(' ')})\n`);
  return entries;
}

export async function frontendOperation(config, op) {
  const snapshot = readSnapshot(config);
  const deadline = Date.now() + snapshot.parsed.lifecycle.timeouts.startMs;
  for (const instance of snapshot.parsed.frontend.instances) {
    if (op === 'close' && readSnapshot(config).closedFrontends?.includes(instance.id)) continue;
    for (;;) {
      try { await callRunControl(runtimeFor(config), op, {}, op === 'health' ? 1000 : snapshot.parsed.lifecycle.timeouts.startMs, `frontend-${instance.id}.json`); break; }
      catch (error) { if (op !== 'health' || Date.now() >= deadline) throw error; await sleep(); }
    }
    if (op === 'close') updateSession(config, { closedFrontends: [...(readSnapshot(config).closedFrontends ?? []), instance.id] });
  }
  return { [op]: true };
}
