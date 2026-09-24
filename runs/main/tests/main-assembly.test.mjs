import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { loadRunConfig, resolveRunAssembly, loadRunNodes } from '../../../packages/tooling/run/index.mjs'
import { createRunHost } from '../host.mjs'

describe('runs/main integrated assembly', () => {
  it('assembles all core plugins with isolated dependencies and valid host roots', async () => {
    const configPath = fileURLToPath(new URL('../run.config.json', import.meta.url))
    const initial = loadRunConfig(configPath)
    const parsed = await resolveRunAssembly(initial)

    // Verify plugins and instances declared in main
    expect(parsed.plugins.backend.map((p) => p.id)).toEqual([
      'example.unified-recorder',
      'example.browser-recorder',
      'example.os-recorder',
      'example.ufo-computer-control',
      'example.browser-executor',
      'example.agent-executor',
      'example.agent-monitor',
    ])
    expect(parsed.plugins.frontend.map((p) => p.id)).toEqual([
      'example.unified-recorder',
    ])
    expect(parsed.graph.instances.map((g) => g.id)).toEqual([
      'recorder',
      'browser-recorder',
      'os-recorder',
      'computer',
      'browser',
      'agent',
      'monitor',
    ])
    expect(parsed.frontend.instances.map((f) => f.id)).toEqual([
      'main-ui',
    ])

    // Verify host creation
    const tempDir = mkdtempSync(join(tmpdir(), 'gvsdk-main-test-'))
    try {
      const host = await createRunHost({
        parsed,
        runtimeDirectory: join(tempDir, 'runtime'),
      })

      expect(typeof host.dependenciesFor).toBe('function')
      expect(typeof host.startPolling).toBe('function')
      expect(typeof host.stopPolling).toBe('function')
      expect(host.hostRoots).toEqual([
        {
          frontendId: 'main-ui',
          targetNodeId: 'recorder/observation',
          infoType: 'PollUnifiedEventsInfo',
        },
      ])

      // Assembled nodes verification
      const assembled = await loadRunNodes(parsed, host.dependenciesFor)
      const nodeIds = assembled.nodes.map((n) => n.id)

      expect(nodeIds).not.toContain('topology/orders')
      expect(nodeIds).toContain('recorder/session')
      expect(nodeIds).toContain('recorder/execution')
      expect(nodeIds).toContain('recorder/observation')
      expect(nodeIds).toContain('browser-recorder/session')
      expect(nodeIds).toContain('browser-recorder/execution')
      expect(nodeIds).toContain('browser-recorder/observation')
      expect(nodeIds).toContain('os-recorder/session')
      expect(nodeIds).toContain('os-recorder/execution')
      expect(nodeIds).toContain('os-recorder/observation')
      expect(nodeIds).toContain('computer/session')
      expect(nodeIds).toContain('computer/request')
      expect(nodeIds).toContain('computer/execution')
      expect(nodeIds).toContain('computer/observation')
      expect(nodeIds).toContain('browser/session')
      expect(nodeIds).toContain('browser/observation')
      expect(nodeIds).toContain('browser/result')
      expect(nodeIds).toContain('agent/session')
      expect(nodeIds).toContain('agent/result')
      expect(nodeIds).toContain('agent/tool-observation-7')
      expect(nodeIds).toContain('monitor/session')

      // Check unified-recorder adapters
      const recorderExecution = assembled.nodes.find((n) => n.id === 'recorder/execution')
      expect(recorderExecution?.desktopControl?.id).toBe('unified/desktop-control')
      expect(recorderExecution?.browserControl?.id).toBe('unified/browser-control')

      const recorderObservation = assembled.nodes.find((n) => n.id === 'recorder/observation')
      expect(recorderObservation?.desktopObservation?.id).toBe('unified/desktop-observation')
      expect(recorderObservation?.desktopEvents?.id).toBe('unified/desktop-events')
      expect(recorderObservation?.browserEvents?.id).toBe('unified/browser-events')

      // Check browser-recorder adapters
      const browserExecution = assembled.nodes.find((n) => n.id === 'browser-recorder/execution')
      expect(browserExecution?.captureControl?.id).toBe('browser/capture-control')

      // Check os-recorder adapters
      const osExecution = assembled.nodes.find((n) => n.id === 'os-recorder/execution')
      expect(osExecution?.captureControl?.id).toBe('ufo/psr-capture-control')

      // Check computer control adapters
      const computerExecution = assembled.nodes.find((n) => n.id === 'computer/execution')
      expect(computerExecution?.computerExecution?.id).toBe('ufo/computer-execution')
      expect(assembled.nodes.find((n) => n.id === 'browser/execution')?.browserExecution?.id).toBe('browser/executor')
      expect(assembled.nodes.find((n) => n.id === 'agent/execution-0')?.runAgent?.id).toBe('agent/run')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
