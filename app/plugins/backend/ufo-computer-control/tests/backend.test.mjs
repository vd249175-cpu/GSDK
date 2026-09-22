import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestRuntime } from '@graphframework/sdk/testing'
import { createUfoComputerControl } from '../index.mjs'

const pluginDirectory = fileURLToPath(new URL('..', import.meta.url))

describe('UFO computer control public entrypoints', () => {
  it('resolves the plugin root and bridge exports', () => {
    const manifest = JSON.parse(readFileSync(resolve(pluginDirectory, 'package.json'), 'utf8'))
    expect(manifest.exports).toMatchObject({
      '.': './index.mjs',
      './bridge': './bridge/ufo-computer-bridge.mjs',
    })
    for (const target of Object.values(manifest.exports)) {
      expect(existsSync(resolve(pluginDirectory, target))).toBe(true)
    }
  })
})

const assemble = ({ failExecution = false, failObservation = false } = {}) => {
  const calls = []
  const observation = {
    selectedWindow: { id: '2', name: 'GraphFramework', handle: 42 },
    windows: [{ id: '2', name: 'GraphFramework', handle: 42 }],
    controls: [{ id: '7', name: 'Start', type: 'Button' }],
    screenshotPath: 'C:\\observations\\r-1.png',
    observedAt: '2026-09-21T04:00:00.000Z',
  }
  const nodes = createUfoComputerControl({
    instanceId: 'computer',
    nodeIdFor: (local) => `computer/${local}`,
    dependencies: {
      ufoComputerExecution: {
        id: 'ufo/computer-execution',
        execute: async (request) => {
          calls.push({ kind: 'execute', request })
          if (failExecution) throw new Error('click rejected')
          return { command: request.action.command, status: 'executed' }
        },
      },
      ufoComputerObservation: {
        id: 'ufo/computer-observation',
        execute: async (request) => {
          calls.push({ kind: 'observe', request })
          if (failObservation) throw new Error('window disappeared')
          return observation
        },
      },
    },
  })
  return { calls, nodes: Object.values(nodes), observation }
}

describe('UFO computer control causal flow', () => {
  it('injects inspection intent and accepts only observation-node facts', async () => {
    const { calls, nodes, observation } = assemble()
    const runtime = createTestRuntime({ nodes })

    runtime.inject({
      targetNodeId: 'computer/session',
      info: { type: 'InspectComputerInfo', requestId: 'r-1', observation: { mode: 'desktop' } },
    })
    await runtime.waitForQuiescence()

    expect(calls).toEqual([{ kind: 'observe', request: { requestId: 'r-1', observation: { mode: 'desktop' } } }])
    expect(runtime.getState('computer/session')).toMatchObject({
      status: 'idle',
      requestId: 'r-1',
      observation,
      screenshotPath: observation.screenshotPath,
      lastError: null,
    })
    runtime.dispose()
  })

  it('executes first and then asks the observation node to verify physical state', async () => {
    const { calls, nodes } = assemble()
    const runtime = createTestRuntime({ nodes })

    runtime.inject({
      targetNodeId: 'computer/session',
      info: {
        type: 'ControlComputerInfo',
        requestId: 'r-2',
        action: { command: 'click_input', controlId: '7', controlName: 'Start', args: { button: 'left' } },
        observation: { mode: 'selected-window', includeControls: true },
      },
    })
    await runtime.waitForQuiescence()

    expect(calls.map((entry) => entry.kind)).toEqual(['execute', 'observe'])
    expect(runtime.getState('computer/session')).toMatchObject({
      status: 'idle',
      requestId: 'r-2',
      operation: 'click_input',
      actionResult: { command: 'click_input', status: 'executed' },
      lastError: null,
    })
    runtime.dispose()
  })

  it('turns execution failures into owner-visible causal state without observing', async () => {
    const { calls, nodes } = assemble({ failExecution: true })
    const runtime = createTestRuntime({ nodes })

    runtime.inject({
      targetNodeId: 'computer/session',
      info: { type: 'ControlComputerInfo', requestId: 'r-3', action: { command: 'focus_window' } },
    })
    await runtime.waitForQuiescence()

    expect(calls.map((entry) => entry.kind)).toEqual(['execute'])
    expect(runtime.getState('computer/session')).toMatchObject({ status: 'error', lastError: 'click rejected' })
    runtime.dispose()
  })
})
