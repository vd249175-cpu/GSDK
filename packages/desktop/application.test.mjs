import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadApplication } from './application.mjs'
import { loadBackendPlugins } from './host/plugin-loader.mjs'

describe('application assembly', () => {
  it('loads the repository application with plugin-owned host and renderer', () => {
    const app = loadApplication()
    expect(app.hostEntry).toBe(resolve(app.directory, 'plugins/frontend/graphvideo.studio/desktop/main.mjs'))
    expect(app.rendererEntry).toBe(resolve(app.directory, 'plugins/frontend/graphvideo.studio/frontend/main.tsx'))
  })
  it('resolves and loads a plugin outside the application directory and rejects entry escape', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gv-assembly-'))
    try {
      mkdirSync(join(root, 'application')); mkdirSync(join(root, 'external-plugin'))
      writeFileSync(join(root, 'external-plugin/package.json'), JSON.stringify({ type: 'module' }))
      writeFileSync(join(root, 'external-plugin/graphvideo.plugin.json'), JSON.stringify({ id: 'test.plugin', apiVersion: 1, contributes: { backend: 'backend.mjs' } }))
      writeFileSync(join(root, 'external-plugin/backend.js'), "export default { id: 'test.plugin', createNodes: () => [] }")
      const config = { plugins: [{ id: 'test.plugin', path: '../external-plugin' }], desktop: {
        host: { pluginId: 'test.plugin', entry: 'desktop/main.mjs' }, renderer: { pluginId: 'test.plugin', entry: 'frontend/main.tsx' },
      } }
      const file = join(root, 'application/application.json')
      writeFileSync(file, JSON.stringify(config))
      expect(loadApplication(file).hostEntry).toBe(join(root, 'external-plugin/desktop/main.mjs'))
      expect((await loadBackendPlugins(loadApplication(file))).map((plugin) => plugin.id)).toEqual(['test.plugin'])
      config.desktop.host.entry = '../../escape.mjs'
      writeFileSync(file, JSON.stringify(config))
      expect(() => loadApplication(file)).toThrow('escapes')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
