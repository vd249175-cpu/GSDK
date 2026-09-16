export type InterfaceFont = 'default' | 'system' | 'mono'
export type InterfaceFontSize = 'compact' | 'standard' | 'comfortable'

export interface TypographyPreferences {
  font: InterfaceFont
  size: InterfaceFontSize
}

const fontStorageKey = 'graphvideo-interface-font'
const sizeStorageKey = 'graphvideo-interface-font-size'
const supportedFonts: InterfaceFont[] = ['default', 'system', 'mono']
const supportedSizes: InterfaceFontSize[] = ['compact', 'standard', 'comfortable']

export const interfaceFontOptions: Array<{ value: InterfaceFont; label: string }> = [
  { value: 'default', label: '默认' },
  { value: 'system', label: '系统' },
  { value: 'mono', label: '等宽' },
]

export const interfaceFontSizeOptions: Array<{ value: InterfaceFontSize; label: string }> = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'comfortable', label: '舒适' },
]

const defaultStorage = {
  getItem: (key: string) => (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function' ? localStorage.getItem(key) : null),
  setItem: (key: string, value: string) => {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(key, value)
    }
  },
}

export function readTypographyPreferences(
  storage: Pick<Storage, 'getItem'> = defaultStorage,
): TypographyPreferences {
  const storedFont = storage.getItem(fontStorageKey) as InterfaceFont | null
  const storedSize = storage.getItem(sizeStorageKey) as InterfaceFontSize | null
  return {
    font: storedFont && supportedFonts.includes(storedFont) ? storedFont : 'default',
    size: storedSize && supportedSizes.includes(storedSize) ? storedSize : 'standard',
  }
}

export function applyTypographyPreferences(
  preferences: TypographyPreferences,
  root: HTMLElement = document.documentElement,
  storage: Pick<Storage, 'setItem'> = defaultStorage,
) {
  root.dataset.fontFamily = preferences.font
  root.dataset.fontSize = preferences.size
  storage.setItem(fontStorageKey, preferences.font)
  storage.setItem(sizeStorageKey, preferences.size)
}
