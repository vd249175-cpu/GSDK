import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { locateNativeBinding } from '@graphvideo/sdk/node'
import studioPlugin from '../backend.ts'
import { createEmptyNativeGraphHost } from '@graphvideo/desktop/graph-host'

let host
const signalListeners = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, new Set(process.listeners(signal))]))
afterEach(async () => {
  for (const [signal, previous] of signalListeners) {
    for (const listener of process.listeners(signal)) if (!previous.has(listener)) process.removeListener(signal, listener)
  }
  if (host) await host.dispose()
  host = null
  vi.resetModules()
  vi.restoreAllMocks()
  vi.doUnmock('electron')
  vi.doUnmock('node:http')
  vi.doUnmock('@graphvideo/desktop/application')
  vi.doUnmock('@graphvideo/desktop/plugin-loader')
  vi.doUnmock('@graphvideo/desktop/graph-host')
  vi.doUnmock('@graphvideo/desktop/agent-control')
  vi.doUnmock('./services/project-history.mjs')
})

async function loadMain({ failWindow = false } = {}) {
  const errors = []
  vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map((value) => String(value)).join(' ')))
  let ready
  const readyGate = new Promise((resolve) => { ready = resolve })
  const app = new EventEmitter()
  let isReady = false
  let exits = 0
  app.whenReady = () => readyGate
  app.isReady = () => isReady
  app.getPath = () => process.cwd()
  app.requestSingleInstanceLock = () => true
  app.exit = vi.fn()
  app.quit = () => {
    let prevented = false
    app.emit('before-quit', { preventDefault() { prevented = true } })
    if (!prevented) exits++
  }
  const windows = []
  class BrowserWindow extends EventEmitter {
    static getAllWindows() { return windows.filter((window) => !window.destroyed) }
    constructor() {
      super()
      windows.push(this)
      this.webContents = new EventEmitter()
      this.webContents.send = () => {}
    }
    isDestroyed() { return this.destroyed === true }
    close() { this.destroyed = true; this.emit('closed') }
    destroy() { this.close() }
    async loadFile() { if (failWindow) throw new Error('renderer unavailable') }
    async loadURL() { if (failWindow) throw new Error('renderer unavailable') }
    isMinimized() { return false }
    restore() {}
    focus() {}
    getSize() { return [1440, 900] }
    getTitle() { return 'Studio' }
    getBounds() { return { width: 1440, height: 900 } }
  }
  const ipc = new EventEmitter()
  const handlers = new Map()
  ipc.handle = (channel, handler) => handlers.set(channel, handler)
  ipc.removeHandler = (channel) => handlers.delete(channel)
  let handled = false
  const protocol = {
    registerSchemesAsPrivileged: vi.fn(), handle: () => { handled = true },
    isProtocolHandled: async () => handled, unhandle: () => { handled = false },
  }
  const server = new EventEmitter()
  server.listen = (_port, _address, callback) => callback()
  server.close = vi.fn((callback) => callback())
  server.closeAllConnections = vi.fn()
  const closeAgent = vi.fn(async () => {})
  const dialog = { showErrorBox: vi.fn() }
  vi.doMock('electron', () => ({ app, BrowserWindow, ipcMain: ipc, protocol, dialog, clipboard: {}, shell: {} }))
  vi.doMock('node:http', () => ({ createServer: () => server }))
  vi.doMock('@graphvideo/desktop/application', () => ({ loadApplication: () => ({ directory: process.cwd(), rendererFile: 'test.html', plugins: [] }) }))
  vi.doMock('@graphvideo/desktop/plugin-loader', () => ({ loadBackendPlugins: async () => [studioPlugin] }))
  vi.doMock('@graphvideo/desktop/graph-host', () => ({ createEmptyNativeGraphHost: (options) => {
    host = createEmptyNativeGraphHost(options)
    return host
  } }))
  vi.doMock('@graphvideo/desktop/agent-control', () => ({ startAgentControlServer: async () => ({ close: closeAgent }) }))
  vi.doMock('./services/project-history.mjs', () => ({ getProjectHistory: () => ({ list: async () => [] }) }))
  await import('./main.mjs')
  return { app, windows, handlers, server, closeAgent, dialog, errors,
    ready: () => { isReady = true; ready() }, get exits() { return exits } }
}

describe.skipIf(!locateNativeBinding())('Electron main lifecycle with controlled adapters', () => {
  it('boots Rust before ready, then closes through Info before unmounting and releasing services', async () => {
    const main = await loadMain()
    expect(host.space.admittedEntities()).toEqual([])
    main.ready()
    await vi.waitFor(() => expect(host.readNodeState('node-application-lifecycle')?.phase, main.errors.join('\n')).toBe('Ready'))
    main.app.quit()
    main.app.quit()
    await vi.waitFor(() => expect(main.exits).toBe(1))
    expect(main.windows[0].isDestroyed()).toBe(true)
    expect(host.space.admittedEntities()).toEqual([])
    expect(main.handlers.size).toBe(0)
    expect(main.closeAgent).toHaveBeenCalledTimes(1)
    expect(main.server.close).toHaveBeenCalledTimes(1)
    expect(main.dialog.showErrorBox).not.toHaveBeenCalled()
  })

  it('quits during bootstrap without mounting nodes or opening a window', async () => {
    const main = await loadMain()
    main.app.quit()
    main.ready()
    await vi.waitFor(() => expect(main.exits).toBe(1))
    expect(main.windows).toEqual([])
    expect(host.space.admittedEntities()).toEqual([])
    expect(main.app.exit).not.toHaveBeenCalled()
  })
  it('cleans the mounted graph and services after a failed window startup', async () => {
    const main = await loadMain({ failWindow: true })
    main.ready()
    await vi.waitFor(() => expect(main.app.exit).toHaveBeenCalledWith(1))
    expect(main.windows[0].isDestroyed()).toBe(true)
    expect(host.space.admittedEntities()).toEqual([])
    expect(main.handlers.size).toBe(0)
    expect(main.closeAgent).toHaveBeenCalledTimes(1)
    expect(main.server.close).toHaveBeenCalledTimes(1)
  })
})
