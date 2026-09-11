import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyThemePreference, defaultTheme, isThemeName, readThemePreference,
} from './themePreferences'

beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  })
})

describe('Theme preferences', () => {
  it('falls back from unsupported persisted values', () => {
    localStorage.setItem('graphvideo-theme', 'no-such-theme')
    expect(readThemePreference('light')).toBe('light')
    expect(readThemePreference()).toBe(defaultTheme)
    expect(isThemeName('xueqing')).toBe(true)
    expect(isThemeName('no-such-theme')).toBe(false)
  })

  it('applies the theme to the root element and persists it', () => {
    applyThemePreference('shiliuqun')
    expect(document.documentElement.dataset.theme).toBe('shiliuqun')
    expect(localStorage.getItem('graphvideo-theme')).toBe('shiliuqun')
    expect(readThemePreference('dark')).toBe('shiliuqun')
    document.documentElement.removeAttribute('data-theme')
  })
})
