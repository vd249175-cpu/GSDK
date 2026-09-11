const minimumWindowWidth = 960
const minimumWindowHeight = 640

/**
 * Native-window policy belongs to the Electron host. Keeping it independent
 * from Electron makes the macOS title-bar contract regression-testable.
 */
export function createStudioWindowOptions({
  config = {},
  platform = process.platform,
  nativeWindowBackground,
  preloadPath,
} = {}) {
  const isMac = platform === 'darwin'
  const width = Math.max(minimumWindowWidth, Number(config.width) || 1440)
  const height = Math.max(minimumWindowHeight, Number(config.height) || 900)

  return {
    width,
    height,
    minWidth: minimumWindowWidth,
    minHeight: minimumWindowHeight,
    show: false,
    // The renderer supplies the draggable area. On macOS the native traffic
    // lights remain available inside the hidden title bar instead.
    frame: config.frameless === false,
    ...(isMac ? {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 11 },
      autoHideMenuBar: false,
    } : {
      autoHideMenuBar: true,
    }),
    backgroundColor: nativeWindowBackground,
    title: typeof config.title === 'string' ? config.title : 'GraphVideo Studio',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}
