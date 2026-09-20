import { describe, expect, it } from 'vitest'
import { createCdpRecorder, CONTROL_ADAPTER_ID, EVENTS_ADAPTER_ID } from '../cdp-recorder.mjs'

describe('cdp-recorder', () => {
  it('导出标准 Adapter 结构与 ID', () => {
    const recorder = createCdpRecorder()
    expect(recorder.captureControl.id).toBe(CONTROL_ADAPTER_ID)
    expect(recorder.captureEvents.id).toBe(EVENTS_ADAPTER_ID)
  })

  it('未探测到浏览器时抛出明确友好的错误提示', async () => {
    const recorder = createCdpRecorder({ cdpUrl: 'http://127.0.0.1:59999' })
    await expect(recorder.captureControl.execute({ op: 'start', sessionId: 's-fail' }))
      .rejects.toThrow('无法连接到专用浏览器')
  })

  it('未知操作抛出错误', async () => {
    const recorder = createCdpRecorder()
    await expect(recorder.captureControl.execute({ op: 'invalid' }))
      .rejects.toThrow('未知 capture-control 请求')
    await expect(recorder.captureEvents.execute({ op: 'invalid' }))
      .rejects.toThrow('未知 capture-events 请求')
  })
})
