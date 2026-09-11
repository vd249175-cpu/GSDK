import { describe, expect, it, vi } from 'vitest'
import { applyTypographyPreferences, readTypographyPreferences } from './typographyPreferences'

describe('Typography preferences', () => {
  it('falls back from unsupported persisted values', () => {
    const storage = { getItem: vi.fn((key: string) => key.endsWith('font') ? 'unknown' : 'huge') }
    expect(readTypographyPreferences(storage)).toEqual({ font: 'default', size: 'standard' })
  })

  it('applies and persists the selected interface font and size', () => {
    const root = document.createElement('html')
    const storage = { setItem: vi.fn() }
    applyTypographyPreferences({ font: 'mono', size: 'comfortable' }, root, storage)
    expect(root.dataset).toMatchObject({ fontFamily: 'mono', fontSize: 'comfortable' })
    expect(storage.setItem).toHaveBeenCalledWith('graphvideo-interface-font', 'mono')
    expect(storage.setItem).toHaveBeenCalledWith('graphvideo-interface-font-size', 'comfortable')
  })
})
