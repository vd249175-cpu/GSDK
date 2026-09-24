import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadRunConfig, resolveRunAssembly, loadRunNodes } from '../../../packages/tooling/run/index.mjs'
import { createRunHost } from '../host.mjs'

describe('agent tool socket run assembly', () => {
  it('assembles graph ports and an independent monitor', async () => {
    const configPath = fileURLToPath(new URL('../run.config.json', import.meta.url))
    const parsed = await resolveRunAssembly(loadRunConfig(configPath))
    const host = await createRunHost({ parsed })
    try {
      const { nodes } = await loadRunNodes(parsed, host.dependenciesFor)
      expect(nodes.map((node) => node.id)).toContain('agent/session')
      expect(nodes.map((node) => node.id)).toContain('agent/tool-observation-7')
      expect(nodes.map((node) => node.id)).toContain('monitor/session')
      expect(nodes.find((node) => node.id === 'agent/execution-0').runAgent.id).toBe('agent/run')
      expect(nodes.find((node) => node.id === 'agent/tool-0').graphToolExecution.id).toBe('agent/tool-execution')
    } finally { await host.dispose() }
  })
})
