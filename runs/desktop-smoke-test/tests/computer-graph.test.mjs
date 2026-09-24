import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { createTestRuntime } from '@graphframework/sdk/testing'
import { createUfoComputerControl } from '../../../app/plugins/backend/ufo-computer-control/index.mjs'
import { loadRunConfig, resolveRunAssembly, loadRunNodes } from '../../../packages/tooling/run/index.mjs'
import { createRunHost } from '../host.mjs'

describe('desktop smoke run computer graph', () => {
  it('routes a desktop action and its physical observation back into the graph', async () => {
    const configPath = fileURLToPath(new URL('../run.config.json', import.meta.url))
    const parsed = await resolveRunAssembly(loadRunConfig(configPath))
    const calls = []
    const computerBridge = {
      executionAdapter: {
        id: 'ufo/computer-execution',
        execute: async (request) => {
          calls.push({ phase: 'execute', request })
          return { command: request.action.command, status: 'executed' }
        },
      },
      observationAdapter: {
        id: 'ufo/computer-observation',
        execute: async (request) => {
          calls.push({ phase: 'observe', request })
          return { mode: 'after-action', selectedWindow: { name: 'GraphFramework' }, observedAt: '2026-09-24T00:00:00Z' }
        },
      },
      stop: async () => calls.push({ phase: 'stop' }),
    }
    const host = await createRunHost({ parsed, computerBridge })
    const assembled = await loadRunNodes(parsed, host.dependenciesFor)
    const execution = assembled.nodes.find((node) => node.id === 'computer/execution')
    const observation = assembled.nodes.find((node) => node.id === 'computer/observation')
    expect(execution?.computerExecution).toBe(computerBridge.executionAdapter)
    expect(observation?.computerObservation).toBe(computerBridge.observationAdapter)

    const nodes = createUfoComputerControl({ instanceId: 'computer', dependencies: host.dependenciesFor({ id: 'computer' }) })
    const runtime = createTestRuntime({ nodes: Object.values(nodes) })
    try {
      runtime.inject({
        targetNodeId: 'computer/request',
        info: {
          type: 'ControlComputerInfo',
          requestId: 'desktop-action-1',
          action: { command: 'focus_window', window: { titleContains: 'GraphFramework' } },
          observation: { mode: 'after-action', includeControls: true },
        },
      })
      await runtime.waitForQuiescence()
      expect(calls.map((call) => call.phase)).toEqual(['execute', 'observe'])
      expect(calls[0].request).toMatchObject({ requestId: 'desktop-action-1', action: { command: 'focus_window' } })
      expect(calls[1].request).toMatchObject({ requestId: 'desktop-action-1', observation: { mode: 'after-action' } })
      expect(runtime.getState('computer/session')).toMatchObject({
        status: 'idle',
        requestId: 'desktop-action-1',
        actionResult: { command: 'focus_window', status: 'executed' },
        observation: { selectedWindow: { name: 'GraphFramework' } },
      })
    } finally {
      runtime.dispose()
      await host.stopSources()
    }
    expect(calls.at(-1).phase).toBe('stop')
  })
})
