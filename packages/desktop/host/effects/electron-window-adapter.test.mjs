import { describe, expect, it, vi } from 'vitest'
import { createElectronWindowAdapter } from './electron-window-adapter.mjs'
import { EventEmitter } from 'node:events'

function fixture() {
  let window = null
  const openWindow = vi.fn(async (config) => {
    let destroyed = false
    let maximized = false
    let title = config.title
    let size = [config.width, config.height]
    window = Object.assign(new EventEmitter(), {
      isDestroyed: () => destroyed,
      isMinimized: () => false,
      isMaximized: () => maximized,
      getTitle: () => title,
      getSize: () => size,
      setTitle: (value) => { title = value },
      setSize: (width, height) => { size = [width, height] },
      focus: vi.fn(),
      minimize: vi.fn(),
      maximize: () => { maximized = true },
      unmaximize: () => { maximized = false },
      webContents: { reload: vi.fn() },
      close: () => { window.emit('close', { defaultPrevented: false }); setImmediate(() => { destroyed = true; window.emit('closed') }); },
    })
    return window
  })
  return { adapter: createElectronWindowAdapter({ openWindow, getWindow: () => window }), openWindow }
}

describe('physical Electron window adapter', () => {
  it('opens a window once, performs actions and reports physical close', async () => {
    const { adapter, openWindow } = fixture()
    const config = { title: 'Studio', width: 1440, height: 900 }
    expect(await adapter.execute({ type: 'OPEN', config })).toMatchObject({ type: 'OPENED', isWindowOpen: true, config })
    expect(await adapter.execute({ type: 'OPEN', config })).toMatchObject({ type: 'OPENED', isWindowOpen: true })
    expect(openWindow).toHaveBeenCalledTimes(1)
    expect(await adapter.execute({ type: 'TOGGLE_MAXIMIZE' })).toMatchObject({ type: 'MAXIMIZED', isWindowOpen: true })
    expect(await adapter.execute({ type: 'CLOSE' })).toMatchObject({ type: 'CLOSED', isWindowOpen: false })
  })
})
