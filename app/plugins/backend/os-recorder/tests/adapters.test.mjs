import { describe, expect, it } from 'vitest'
import {
  createOsCaptureControlAdapter,
  createOsCaptureEventsAdapter,
} from '../index.mjs'

const fakeSidecar = (routes, seen = []) => async (path, { method = 'GET', body } = {}) => {
  seen.push({ path, method, body })
  const out = routes.shift()
  if (out instanceof Error) throw out
  return out ?? {}
}

describe('ufo sidecar adapters', () => {
  it('start 取句柄 / stop 回传动作 / 未知 op 抛错', async () => {
    const seen = []
    const control = createOsCaptureControlAdapter({
      request: fakeSidecar([{ handle: 'ufo-handle-1' }, { events: [{ kind: 'click', x: 1, y: 2 }] }], seen),
    })
    expect(await control.execute({ op: 'start', sessionId: 's-1' })).toEqual({ handle: 'ufo-handle-1' })
    expect(await control.execute({ op: 'stop', sessionId: 's-1' })).toEqual({
      stopped: true,
      actions: [{ kind: 'click', x: 1, y: 2 }],
    })
    expect(seen).toEqual([
      { path: '/capture/start', method: 'POST', body: { sessionId: 's-1' } },
      { path: '/capture/stop', method: 'POST', body: { sessionId: 's-1' } },
    ])
    await expect(control.execute({ op: 'rewind' })).rejects.toThrow('未知 capture-control 请求')
  })

  it('start 缺句柄时回退为本地句柄', async () => {
    const control = createOsCaptureControlAdapter({ request: fakeSidecar([{}]) })
    expect(await control.execute({ op: 'start', sessionId: 's-9' })).toEqual({ handle: 'ufo:s-9' })
  })

  it('poll 透传事件与 cursor', async () => {
    const seen = []
    const events = createOsCaptureEventsAdapter({
      request: fakeSidecar([{
        events: [{ kind: 'key', key: 'Enter' }],
        cursor: 'c-1',
      }], seen),
    })
    const observation = await events.execute({ op: 'poll', sessionId: 's-1', cursor: 'c-0' })
    expect(observation).toEqual({
      events: [{ kind: 'key', key: 'Enter' }],
      cursor: 'c-1',
    })
    expect(seen[0].path).toContain('/capture/events')
    expect(seen[0].path).toContain('sessionId=s-1')
  })

  it('缺少 request 构造即抛错', () => {
    expect(() => createOsCaptureControlAdapter({})).toThrow('request')
    expect(() => createOsCaptureEventsAdapter({})).toThrow('request')
  })
})
