/** IPC authority belongs to the main window's current top-level document,
 * never to arbitrary windows or child frames that happen to use its URL. */
export function createRendererSecurity({ rendererEntryUrl }) {
  const trusted = new Set()
  const isEntry = (value) => {
    try {
      const actual = new URL(value)
      const expected = new URL(rendererEntryUrl)
      actual.hash = ''; expected.hash = ''
      return actual.href === expected.href
    } catch { return false }
  }
  const canSend = (contents) => trusted.has(contents)
    && !contents.isDestroyed() && isEntry(contents.getURL())
  return {
    canSend,
    trustWindow(window) {
      const contents = window.webContents
      trusted.add(contents)
      contents.once('destroyed', () => trusted.delete(contents))
      contents.on('will-navigate', (event, url) => {
        if (!isEntry(event.url ?? url)) event.preventDefault()
      })
      contents.on('will-redirect', (event, url) => {
        if (!isEntry(event.url ?? url)) event.preventDefault()
      })
      contents.on('will-attach-webview', (event) => event.preventDefault())
      contents.on('did-create-window', (child) => {
        // Floating panels are about:blank portals using the opener's client.
        // They have no independent native/IPC authority and cannot navigate.
        child.webContents.on('will-navigate', (event) => event.preventDefault())
        child.webContents.on('will-redirect', (event) => event.preventDefault())
        child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      })
    },
    assertSender(event) {
      if (!event?.senderFrame || event.senderFrame !== event.sender?.mainFrame
        || !canSend(event.sender) || !isEntry(event.senderFrame.url)) {
        throw new Error('拒绝不受信任的 IPC 来源')
      }
    },
  }
}

export function secureIpc(ipcMain, security, invoke = (_channel, action) => action()) {
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => {
        security.assertSender(event)
        return invoke(channel, () => handler(event, ...args))
      })
    },
    on(channel, handler) {
      ipcMain.on(channel, (event, ...args) => {
        // Event IPC has no rejection channel; ignore unauthorized messages.
        try { security.assertSender(event) } catch { return }
        handler(event, ...args)
      })
    },
    removeHandler(channel) { ipcMain.removeHandler(channel) },
  }
}
