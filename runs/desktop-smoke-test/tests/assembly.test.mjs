import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { loadRunConfig, resolveRunAssembly, loadRunNodes } from '../../../packages/tooling/run/index.mjs'
import { createRunHost } from '../host.mjs'

describe('desktop workflow assembly', () => {
  it('passes completed test facts to the agent when world review becomes pending', async () => {
    const configPath = fileURLToPath(new URL('../run.config.json', import.meta.url))
    const parsed = await resolveRunAssembly(loadRunConfig(configPath))
    const host = await createRunHost({ parsed, showWorldDecision: async () => ({ cancelled: true }),
      computerBridge: { executionAdapter: { id: 'ufo/computer-execution', execute: async () => ({}) },
        observationAdapter: { id: 'ufo/computer-observation', execute: async () => ({}) }, stop: async () => {} },
      chromium: { connectOverCDP: async () => { throw new Error('not called') } },
    })
    const injected = []
    try {
      host.startPolling({
        projection: async () => ({ nodes: { 'smoke/session': { state: {
          pendingConfirmation: { step: 'save-world', requestId: 'review-1',
            browserResult: { opened: true }, desktopActionResult: { command: 'focus_window' },
            observation: { windows: ['GraphFramework'] },
          },
        } } } }),
        inject: async (nodeId, info) => { injected.push({ nodeId, info }) },
      })
      await new Promise((resolve) => setTimeout(resolve, 350))
      expect(injected).toHaveLength(1)
      expect(injected[0].nodeId).toBe('agent/session')
      expect(injected[0].info.text).toContain('GraphFramework')
      expect(injected[0].info.text).toContain('focus_window')
    } finally { await host.dispose() }
  })

  it('routes a failed agent review back to the waiting workflow', async () => {
    const configPath = fileURLToPath(new URL('../run.config.json', import.meta.url))
    const parsed = await resolveRunAssembly(loadRunConfig(configPath))
    const host = await createRunHost({ parsed, showWorldDecision: async () => ({ cancelled: true }),
      computerBridge: { executionAdapter: { id: 'ufo/computer-execution', execute: async () => ({}) },
        observationAdapter: { id: 'ufo/computer-observation', execute: async () => ({}) }, stop: async () => {} },
      chromium: { connectOverCDP: async () => { throw new Error('not called') } },
    })
    const injected = []
    try {
      host.startPolling({
        projection: async () => ({ nodes: {
          'smoke/session': { state: { pendingConfirmation: { step: 'save-world', requestId: 'review-2' } } },
          'agent/result': { state: { threads: { 'smoke:review-2': {
            requestId: 'review-2', status: 'error', error: 'model API key is required',
          } } } },
        } }),
        inject: async (nodeId, info) => { injected.push({ nodeId, info }) },
      })
      await new Promise((resolve) => setTimeout(resolve, 350))
      expect(injected).toEqual([{ nodeId: 'smoke/session', info: {
        type: 'AgentReviewFailedInfo', requestId: 'review-2', message: 'model API key is required',
      } }])
    } finally { await host.dispose() }
  })

  it('mounts browser, computer, agent, and monitor graphs in one run', async () => {
    const configPath = fileURLToPath(new URL('../run.config.json', import.meta.url))
    const parsed = await resolveRunAssembly(loadRunConfig(configPath))
    const host = await createRunHost({ parsed, showWorldDecision: async () => ({ cancelled: true }),
      computerBridge: { executionAdapter: { id: 'ufo/computer-execution', execute: async () => ({}) },
        observationAdapter: { id: 'ufo/computer-observation', execute: async () => ({}) }, stop: async () => {} },
      chromium: { connectOverCDP: async () => { throw new Error('not called') } },
    })
    try {
      const { nodes } = await loadRunNodes(parsed, host.dependenciesFor)
      for (const nodeId of ['smoke/session', 'browser/session', 'computer/session', 'agent/session', 'monitor/session']) {
        expect(nodes.map((node) => node.id)).toContain(nodeId)
      }
      expect(nodes.find((node) => node.id === 'smoke/execution').worldDocument.id).toBe('smoke/world-document')
      expect(nodes.find((node) => node.id === 'smoke/execution').desktopControl.id).toBe('smoke/desktop-control')
    } finally { await host.dispose() }
  })
})
