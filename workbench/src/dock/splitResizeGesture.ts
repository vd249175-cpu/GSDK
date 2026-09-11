import type { DockSplitState } from './workspaceTypes'

const minimumSplitRatio = 0.15
const maximumSplitRatio = 0.85
const ratioEpsilon = 0.000_001

interface SplitBounds {
  width: number
  height: number
}

interface SplitResizeGestureOptions {
  direction: DockSplitState['direction']
  bounds: SplitBounds
  initialRatio: number
  startX: number
  startY: number
  scheduleFrame(callback: () => void): number
  cancelFrame(frameId: number): void
  preview(ratio: number): void
  commit(ratio: number): void
  cancel(): void
}

function clampRatio(ratio: number) {
  return Math.min(maximumSplitRatio, Math.max(minimumSplitRatio, ratio))
}

export function createSplitResizeGesture(options: SplitResizeGestureOptions) {
  const startPointer = options.direction === 'horizontal' ? options.startX : options.startY
  const extent = options.direction === 'horizontal' ? options.bounds.width : options.bounds.height
  let latestRatio = options.initialRatio
  let frameId: number | null = null
  let finished = false

  function ratioAt(clientX: number, clientY: number) {
    if (extent <= 0) return options.initialRatio
    const pointer = options.direction === 'horizontal' ? clientX : clientY
    return clampRatio(options.initialRatio + (pointer - startPointer) / extent)
  }

  function flushPreview() {
    frameId = null
    options.preview(latestRatio)
  }

  function update(clientX: number, clientY: number) {
    if (finished) return
    latestRatio = ratioAt(clientX, clientY)
    if (frameId === null) frameId = options.scheduleFrame(flushPreview)
  }

  function clearScheduledPreview() {
    if (frameId === null) return
    options.cancelFrame(frameId)
    frameId = null
  }

  return {
    move(clientX: number, clientY: number) {
      update(clientX, clientY)
    },
    finish(clientX: number, clientY: number) {
      if (finished) return
      update(clientX, clientY)
      finished = true
      clearScheduledPreview()
      if (Math.abs(latestRatio - options.initialRatio) <= ratioEpsilon) {
        options.cancel()
        return
      }
      options.preview(latestRatio)
      options.commit(latestRatio)
    },
    abort(notify = true) {
      if (finished) return
      finished = true
      clearScheduledPreview()
      if (notify) options.cancel()
    },
  }
}
