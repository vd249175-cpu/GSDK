import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestRuntime } from '@graphframework/sdk/testing'
import { createUnifiedRecorder } from '../index.mjs'
import {
  createRunCli,
  createUnifiedAdapters,
  createWindowsInputEventSource,
} from '../bridge/unified-adapters.mjs'

const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const CDP = 'http://127.0.0.1:9343'
const SESSION = 'unified-e2e-real'
const runCli = createRunCli()

const isBrowserAlive = async () => {
  try {
    const res = await fetch(`${CDP}/json/version`)
    return res.ok
  } catch {
    return false
  }
}

describe('真机单元测试 (Real Device Tests)', () => {
  it('1. 9343 专用 Chrome 真机：attach → recording-start → goto → stop 录制断言', async () => {
    const alive = await isBrowserAlive()
    if (!alive) {
      console.warn('专用浏览器 9343 未运行，跳过真机测试')
      return
    }

    const adapters = createUnifiedAdapters({
      runCli,
      cliSession: SESSION,
      cdpUrl: CDP,
    })

    // 测试自动 attach 与 start
    const started = await adapters.browserControl.execute({ op: 'start', sessionId: 'test-session' })
    expect(started.handle).toContain(`playwright-cli:${SESSION}`)

    // 触发真实浏览器跳转
    await runCli([`-s=${SESSION}`, 'goto', 'https://example.com'])

    // 测试快照轮询
    const polled = await adapters.browserEvents.execute({ op: 'poll', sessionId: 'test-session' })
    expect(polled.events.length).toBeGreaterThanOrEqual(1)
    expect(typeof polled.events[0].snapshot).toBe('string')

    // 测试停止与 Playwright 代码导出
    const stopped = await adapters.browserControl.execute({ op: 'stop', sessionId: 'test-session' })
    expect(stopped.stopped).toBe(true)
    expect(stopped.actions).toContain('page.goto')
    expect(stopped.actions).toContain('https://example.com')
  }, 90000)

  it('2. Windows 输入观察源真机：启动握手与停止生命周期', async () => {
    if (process.platform !== 'win32') return

    const observerScript = join(
      repositoryRoot,
      'app',
      'plugins',
      'backend',
      'unified-recorder',
      'bridge',
      'windows-input-observer.py',
    )

    const source = createWindowsInputEventSource({
      observerScript,
      pythonExecutable: 'python.exe',
      readyTimeoutMs: 15000,
    })

    await source.start()
    const polled = await source.poll()
    expect(Array.isArray(polled.events)).toBe(true)
    await source.stop()
  }, 30000)

  it('3. 真机全因果闭环：双源统一录制 → 实时轮询 → 停止清洗 → Agent 纯文字导出', async () => {
    const alive = await isBrowserAlive()
    if (!alive) {
      console.warn('专用浏览器 9343 未运行，跳过真机因果测试')
      return
    }

    const adapters = createUnifiedAdapters({
      runCli,
      cliSession: SESSION,
      cdpUrl: CDP,
      observerScript: join(
        repositoryRoot,
        'app',
        'plugins',
        'backend',
        'unified-recorder',
        'bridge',
        'windows-input-observer.py',
      ),
    })

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
      const sessionId = `real-e2e-${Date.now()}`

      // 1. 触发统一开始录制
      runtime.inject({
        targetNodeId: 'recorder/session',
        info: { type: 'StartRecordingInfo', sessionId, sources: ['desktop', 'browser'] },
      })
      await runtime.waitForQuiescence()

      const startedState = runtime.getState('recorder/session')
      expect(startedState.status).toBe('recording')
      expect(startedState.sessionId).toBe(sessionId)
      expect(startedState.handles.browser).toBeDefined()
      expect(startedState.handles.desktop).toBeDefined()

      // 2. 真实浏览器动作
      await runCli([`-s=${SESSION}`, 'goto', 'https://example.com'])

      // 3. 轮询双源实时事件
      runtime.inject({
        targetNodeId: 'recorder/observation',
        info: { type: 'PollUnifiedEventsInfo', sessionId, sources: ['desktop', 'browser'] },
      })
      await runtime.waitForQuiescence()

      const duringState = runtime.getState('recorder/session')
      expect(duringState.eventCount).toBeGreaterThanOrEqual(1)

      // 4. 触发停止录制
      runtime.inject({
        targetNodeId: 'recorder/session',
        info: { type: 'StopRecordingInfo' },
      })
      await runtime.waitForQuiescence()

      // 5. 验收最终聚合状态
      const finalState = runtime.getState('recorder/session')
      expect(finalState.status).toBe('idle')
      expect(finalState.lastError).toBeNull()
      expect(finalState.eventCount).toBeGreaterThanOrEqual(1)
      expect(finalState.events.length).toBeGreaterThanOrEqual(1)

      // 6. 验收专供 Agent 纯文字版本
      expect(typeof finalState.agentTranscriptContent).toBe('string')
      expect(finalState.agentTranscriptContent).toContain('# Unified Recording Transcript')
      expect(finalState.agentTranscriptContent).toContain('Step 01')

      // 7. 验收原生导出文件路径
      expect(finalState.nativeExports.browser).toBeDefined()
    } finally {
      runtime.dispose()
      await runCli([`-s=${SESSION}`, 'detach']).catch(() => {})
    }
  }, 120000)
})
