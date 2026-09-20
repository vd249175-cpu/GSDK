import { describe, expect, it } from 'vitest'
import {
  createBrowserCaptureControlAdapter,
  createBrowserCaptureEventsAdapter,
} from '../index.mjs'

const fakeCli = (outputs, seen = []) => async (args) => {
  seen.push(args)
  const out = outputs.shift()
  if (out instanceof Error) throw out
  return out ?? ''
}

describe('capture adapters (playwright-cli)', () => {
  it('start 返回句柄 / stop 回传动作代码 / 未知 op 抛错', async () => {
    const seen = []
    const control = createBrowserCaptureControlAdapter({
      runCli: fakeCli(['', "await page.goto('https://example.com/');\n"], seen),
      session: 'rec',
    })
    expect(await control.execute({ op: 'start', sessionId: 's-1' })).toEqual({ handle: 'playwright-cli:rec:s-1' })
    expect(await control.execute({ op: 'stop', sessionId: 's-1' })).toMatchObject({
      stopped: true,
      actions: expect.stringContaining("page.goto"),
    })
    expect(seen).toEqual([['-s=rec', 'recording-start'], ['-s=rec', 'recording-stop']])
    await expect(control.execute({ op: 'rewind' })).rejects.toThrow('未知 capture-control 请求')
  })

  it('events 轮询返回快照事件并透传 cursor', async () => {
    const seen = []
    const events = createBrowserCaptureEventsAdapter({
      runCli: fakeCli(['- heading "Example Domain"'], seen),
      session: 'rec',
    })
    const observation = await events.execute({ op: 'poll', sessionId: 's-1', cursor: 'c-0' })
    expect(observation.cursor).toBe('c-0')
    expect(observation.events).toHaveLength(1)
    expect(observation.events[0]).toMatchObject({ kind: 'snapshot', sessionId: 's-1' })
    expect(seen).toEqual([['-s=rec', 'snapshot']])
  })

  it('缺少 runCli 构造即抛错', () => {
    expect(() => createBrowserCaptureControlAdapter({})).toThrow('runCli')
    expect(() => createBrowserCaptureEventsAdapter({})).toThrow('runCli')
  })
})
