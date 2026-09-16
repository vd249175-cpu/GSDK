import { describe, expect, it } from 'vitest'
import { isOutsideViewport, synchronizeFloatingRoot } from './floatingWindow'

describe('floating Dock window', () => {
  it('recognizes a panel drag released outside the application viewport', () => {
    expect(isOutsideViewport(-1, 200, 1200, 800)).toBe(true)
    expect(isOutsideViewport(400, 801, 1200, 800)).toBe(true)
    expect(isOutsideViewport(400, 300, 1200, 800)).toBe(false)
  })

  it('copies theme and typography attributes to the popup document', () => {
    const source = document.createElement('html')
    const target = document.createElement('html')
    source.dataset.theme = 'light'
    source.dataset.fontFamily = 'system'
    source.dataset.fontSize = 'comfortable'
    target.dataset.theme = 'dark'
    synchronizeFloatingRoot(source, target)
    expect(target.dataset).toMatchObject({
      theme: 'light', fontFamily: 'system', fontSize: 'comfortable',
    })
  })
})
