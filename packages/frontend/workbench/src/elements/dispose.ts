import type { ElementDispose } from './types'

/** Consume owned cleanups once, in reverse acquisition order. One failure cannot leak siblings. */
export async function disposeReverse(disposers: ElementDispose[]): Promise<void> {
  for (const dispose of disposers.splice(0).reverse()) {
    try { await dispose() } catch (error) { console.error('Element cleanup failed:', error) }
  }
}
