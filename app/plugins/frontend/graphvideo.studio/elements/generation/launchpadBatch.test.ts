import { describe, expect, it } from 'vitest'
import { executeLaunchpadBatch, launchpadBatchCredits } from './launchpadBatch'

describe('launchpad batch execution', () => {
  it('starts every ready item before waiting for batch completion', async () => {
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })

    const execution = executeLaunchpadBatch(['audio', 'image', 'video'], async (item) => {
      started.push(item)
      await gate
      return item !== 'video'
    })

    await Promise.resolve()
    expect(started).toEqual(['audio', 'image', 'video'])

    release()
    await expect(execution).resolves.toEqual({ successCount: 2, failedCount: 1 })
  })

  it('calculates the whole snapshot cost before parallel dispatch', () => {
    expect(launchpadBatchCredits([
      { estimatedCredits: 4.5 },
      { estimatedCredits: 7 },
      { estimatedCredits: 0 },
    ])).toBe(11.5)
  })
})
