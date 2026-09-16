/** 工作台主题与根元素应用：四套内置主题，产品默认可配，用户保存值优先。 */

export type ThemeName = 'dark' | 'light' | 'xueqing' | 'shiliuqun'

export const themeNames: readonly ThemeName[] = ['dark', 'light', 'xueqing', 'shiliuqun']

export const defaultTheme: ThemeName = 'dark'

const themeStorageKey = 'graphvideo-theme'
const themeChangedEvent = 'graphvideo-theme-change'

const defaultStorage = {
  getItem: (key: string) => (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' ? localStorage.getItem(key) : null),
  setItem: (key: string, value: string) => {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(key, value)
    }
  },
}

export function isThemeName(value: unknown): value is ThemeName {
  return themeNames.includes(value as ThemeName)
}

/** 用户保存值优先；缺失或失效回退到产品默认。 */
export function readThemePreference(
  productDefault: ThemeName = defaultTheme,
  storage: Pick<Storage, 'getItem'> = defaultStorage,
): ThemeName {
  const saved = storage.getItem(themeStorageKey)
  return isThemeName(saved) ? saved : productDefault
}

/** 应用到根元素并持久化；浮动窗口经属性同步跟随。 */
export function applyThemePreference(
  theme: ThemeName,
  root: HTMLElement = document.documentElement,
  storage: Pick<Storage, 'setItem'> = defaultStorage,
): void {
  root.dataset.theme = theme
  storage.setItem(themeStorageKey, theme)
  const view = root.ownerDocument?.defaultView
  if (view && typeof view.dispatchEvent === 'function') {
    view.dispatchEvent(new Event(themeChangedEvent))
  }
}
