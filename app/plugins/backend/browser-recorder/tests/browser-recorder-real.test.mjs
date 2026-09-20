import { describe, expect, it } from 'vitest'
import { createTestRuntime } from '@graphframework/sdk/testing'
import { createBrowserRecorder, createCdpRecorder } from '../index.mjs'

describe('browser-recorder real test (9343)', () => {
  it('真实打开与录制因果全链路测试', async () => {
    // 1. 探活 9343 端口
    let browserAlive = false
    try {
      const res = await fetch('http://127.0.0.1:9343/json/version')
      browserAlive = res.ok
    } catch {
      browserAlive = false
    }

    if (!browserAlive) {
      console.warn('专用浏览器 9343 未运行，跳过真实物理测试')
      return
    }

    // 2. 组装 CDP 适配器与节点
    const cdpRecorder = createCdpRecorder({ cdpUrl: 'http://127.0.0.1:9343' })
    const { session, execution, observation } = createBrowserRecorder({
      instanceId: 'recorder',
      nodeIdFor: (local) => `recorder/${local}`,
      dependencies: {
        captureControl: cdpRecorder.captureControl,
        captureEvents: cdpRecorder.captureEvents,
      },
    })

    const runtime = createTestRuntime({ nodes: [session, execution, observation] })

    // 3. 触发开始录制
    const testSessionId = `test-real-${Date.now()}`
    runtime.inject({
      targetNodeId: 'recorder/session',
      info: { type: 'StartRecordingInfo', sessionId: testSessionId },
    })

    // 等待微内核静止（证明没有无限循环，能够立即 quiesce）
    await runtime.waitForQuiescence()

    // 4. 验证开始状态与底层句柄
    const startState = runtime.getState('recorder/session')
    console.log('START STATE:', startState)
    expect(startState.status).toBe('recording')
    expect(startState.sessionId).toBe(testSessionId)
    expect(startState.handle).toMatch(/^cdp:9343:/)
    expect(startState.error ?? null).toBeNull()

    // 5. 真实产生一个页面动作 (在 9343 Chrome 打开一个新标签页并导航)
    let newTabId = null
    try {
      const newTabRes = await fetch('http://127.0.0.1:9343/json/new?https://example.com', { method: 'PUT' })
      if (newTabRes.ok) {
        const newTab = await newTabRes.json()
        newTabId = newTab.id
        // 等待 CDP 接收 Page.frameNavigated 事件并推入队列
        await new Promise((resolve) => setTimeout(resolve, 800))
      }
    } catch {
      // 若无法新建标签页则降级
    }

    // 触发一次 PollRecordingEventsInfo
    runtime.inject({
      targetNodeId: 'recorder/observation',
      info: { type: 'PollRecordingEventsInfo', sessionId: testSessionId },
    })
    await runtime.waitForQuiescence()

    const polledState = runtime.getState('recorder/session')
    console.log('POLLED STATE:', polledState)
    if (newTabId) {
      expect(polledState.eventCount).toBeGreaterThanOrEqual(1)
      expect(polledState.lastActions).toContain('page.goto')
      // 清理测试标签页
      await fetch(`http://127.0.0.1:9343/json/close/${newTabId}`).catch(() => {})
    }

    // 6. 停止录制
    runtime.inject({
      targetNodeId: 'recorder/session',
      info: { type: 'StopRecordingInfo' },
    })
    await runtime.waitForQuiescence()

    // 7. 验证停止状态
    const endState = runtime.getState('recorder/session')
    expect(endState.status).toBe('idle')
    expect(endState.error ?? null).toBeNull()

    runtime.dispose()
  }, 15000)
})
