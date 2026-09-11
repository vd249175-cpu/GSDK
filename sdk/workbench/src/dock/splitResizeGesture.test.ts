import { describe, expect, it, vi } from 'vitest'
import { createSplitResizeGesture } from './splitResizeGesture'

function setup(direction: 'horizontal' | 'vertical' = 'horizontal') {
  const frames = new Map<number, () => void>()
  let sequence = 0
  const preview = vi.fn()
  const commit = vi.fn()
  const cancel = vi.fn()
  const gesture = createSplitResizeGesture({
    direction,
    bounds: { width: 1000, height: 500 },
    initialRatio: 0.5,
    startX: 500,
    startY: 250,
    scheduleFrame(callback) {
      sequence += 1
      frames.set(sequence, callback)
      return sequence
    },
    cancelFrame(frameId) {
      frames.delete(frameId)
    },
    preview,
    commit,
    cancel,
  })
  return { gesture, frames, preview, commit, cancel }
}

describe('split resize gesture', () => {
  it('coalesces pointer moves into one preview per animation frame', () => {
    const { gesture, frames, preview } = setup()
    gesture.move(550, 250)
    gesture.move(600, 250)
    gesture.move(650, 250)

    expect(frames.size).toBe(1)
    frames.values().next().value?.()
    expect(preview).toHaveBeenCalledTimes(1)
    expect(preview).toHaveBeenLastCalledWith(0.65)
  })

  it('commits only the final ratio once when the gesture finishes', () => {
    const { gesture, preview, commit } = setup('vertical')
    gesture.move(500, 300)
    gesture.move(500, 400)
    gesture.finish(500, 450)
    gesture.finish(500, 100)

    expect(preview).toHaveBeenLastCalledWith(0.85)
    expect(commit).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith(0.85)
  })

  it('does not create a layout command for an unchanged or aborted gesture', () => {
    const unchanged = setup()
    unchanged.gesture.finish(500, 250)
    expect(unchanged.commit).not.toHaveBeenCalled()
    expect(unchanged.cancel).toHaveBeenCalledOnce()

    const aborted = setup()
    aborted.gesture.move(700, 250)
    aborted.gesture.abort()
    expect(aborted.frames.size).toBe(0)
    expect(aborted.commit).not.toHaveBeenCalled()
    expect(aborted.cancel).toHaveBeenCalledOnce()
  })
})
