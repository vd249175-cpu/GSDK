import { describe, expect, it } from 'vitest'
import { calculateFloatingThumb } from './FloatingScrollbars'

describe('floating scrollbars', () => {
  it('does not render a thumb when content fits the viewport', () => {
    expect(calculateFloatingThumb(200, 200, 200, 0)).toBeNull()
    expect(calculateFloatingThumb(200, 200, 180, 0)).toBeNull()
  })

  it('maps the scroll position onto the available floating track', () => {
    expect(calculateFloatingThumb(100, 50, 200, 50)).toEqual({
      offset: 25,
      size: 25,
      scrollRange: 150,
      thumbRange: 75,
    })
  })

  it('keeps small thumbs large enough to drag', () => {
    expect(calculateFloatingThumb(100, 10, 1000, 0)?.size).toBe(24)
  })
})
