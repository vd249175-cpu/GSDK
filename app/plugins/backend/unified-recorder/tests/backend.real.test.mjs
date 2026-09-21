import { describe, expect, it } from 'vitest'
import { createTestRuntime } from '@graphframework/sdk/testing'
import { buildReplayScript, buildTranscript, createUnifiedRecorder } from '../index.mjs'
import { createRunCli, createUnifiedAdapters } from '../bridge/unified-adapters.mjs'

/**
 * 真机因果测试：真实浏览器 Adapter（专用 Chrome 9343 + playwright-cli）与
 * 真实 Unified Node（session/execution/observation）走通 start → poll → stop
 * 全结算；桌面侧用本 run 占位 Adapter。9343 不存活则跳过，不视作失败。
 * 个人系统：浏览器 fill 明文原样透传，不做脱敏。
 */

const CDP = 'http://127.0.0.1:9343'
const SESSION = 'unified-real-node'

const runCli = createRunCli()

describe('unified-recorder real causal flow', () => {
  it('真机浏览器 + 占位桌面走通 start → poll → stop 结算', async () => {
    let alive = false
    try {
      alive = (await fetch(`${CDP}/json/version`)).ok
    } catch {
      alive = false
    }
    if (!alive) {
      console.warn('专用浏览器 9343 未运行，跳过真机因果测试')
      return
    }
    await runCli(['attach', `--cdp=${CDP}`, '--session', SESSION])
    const adapters = createUnifiedAdapters({ runCli, cliSession: SESSION })
    const nodes = createUnifiedRecorder({
      instanceId: 'recorder',
      nodeIdFor: (local) => `recorder/${local}`,
      dependencies: {
        desktopControl: adapters.desktopControl,
        browserControl: adapters.browserControl,
        desktopObservation: adapters.desktopObservation,
        desktopEvents: adapters.desktopEvents,
        browserEvents: adapters.browserEvents,
      },
    })
    const runtime = createTestRuntime({ nodes: Object.values(nodes) })
    try {
      const sessionId = `real-${Date.now()}`
      runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'StartRecordingInfo', sessionId } })
      await runtime.waitForQuiescence()
      const started = runtime.getState('recorder/session')
      expect(started).toMatchObject({ status: 'recording', sessionId })
      expect(started.handles.browser).toBe(`playwright-cli:${SESSION}:${sessionId}`)

      await runCli([`-s=${SESSION}`, 'goto', 'https://example.com'])
      runtime.inject({ targetNodeId: 'recorder/observation', info: { type: 'PollUnifiedEventsInfo', sessionId } })
      await runtime.waitForQuiescence()
      const during = runtime.getState('recorder/session')
      expect(during.eventCount).toBeGreaterThanOrEqual(1)
      expect(during.events.some((event) => event.source === 'browser')).toBe(true)

      runtime.inject({ targetNodeId: 'recorder/session', info: { type: 'StopRecordingInfo' } })
      await runtime.waitForQuiescence()
      const end = runtime.getState('recorder/session')
      expect(end.status).toBe('idle')
      expect(end.browserActions).toContain('page.goto')
      expect(buildReplayScript(end.events)).toContain('page.goto')
      expect(buildTranscript(end.events)).toContain('[browser|example.com]')
      expect(end.lastError ?? null).toBeNull()
    } finally {
      runtime.dispose()
      await runCli([`-s=${SESSION}`, 'detach']).catch(() => {})
    }
  }, 120000)
})
