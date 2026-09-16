/** Physical Electron boundary used only by the desktop execution Node. */
export function createElectronWindowAdapter({ openWindow, getWindow }) {
  let frameless = true
  const current = () => {
    const window = getWindow()
    return window && !window.isDestroyed() ? window : null
  }
  const observation = (type, window) => ({
    type,
    isWindowOpen: Boolean(window && !window.isDestroyed()),
    config: window && !window.isDestroyed()
      ? { title: window.getTitle(), width: window.getSize()[0], height: window.getSize()[1], frameless }
      : undefined,
  })

  return {
    id: 'graphvideo/electron-window-v1',
    async execute(request, context) {
      if (context?.signal?.aborted) throw context.signal.reason ?? new Error('Window action canceled')
      context?.recordTransport?.({ portId: 'electron/browser-window', operation: request.type })
      if (request.type === 'OPEN') {
        if (!current()) frameless = request.config.frameless ?? true
        const window = current() ?? await openWindow(request.config)
        if (window.isMinimized()) window.restore()
        window.focus()
        return observation('OPENED', window)
      }
      const window = current()
      if (!window) throw new Error(`Window is closed: ${request.type}`)
      if (request.type === 'CONFIGURE') {
        if (request.config.frameless !== undefined && request.config.frameless !== frameless) {
          throw new Error('Window frame cannot be changed after creation')
        }
        if (request.config.title !== undefined) window.setTitle(request.config.title)
        if (request.config.width !== undefined || request.config.height !== undefined) {
          const [width, height] = window.getSize()
          window.setSize(request.config.width ?? width, request.config.height ?? height)
        }
        return observation('CONFIGURED', window)
      }
      if (request.type === 'MINIMIZE') {
        window.minimize()
        return observation('MINIMIZED', window)
      }
      if (request.type === 'TOGGLE_MAXIMIZE') {
        if (window.isMaximized()) window.unmaximize()
        else window.maximize()
        return observation(window.isMaximized() ? 'MAXIMIZED' : 'UNMAXIMIZED', window)
      }
      if (request.type === 'RELOAD') {
        window.webContents.reload()
        return observation('RELOADED', window)
      }
      if (request.type === 'CLOSE') {
        window.close()
        if (!window.isDestroyed()) throw new Error('Window close was canceled')
        return observation('CLOSED', null)
      }
      throw new Error(`Unsupported window action: ${request.type}`)
    },
  }
}
