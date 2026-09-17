/** Tracks commands at the host boundary without touching business State. */
export function createCommandGate() {
  let accepting = true
  const pending = new Set()
  return {
    get accepting() { return accepting },
    close() { accepting = false },
    run(action) {
      if (!accepting) return Promise.reject(new Error('Application is closing'))
      const operation = Promise.resolve().then(action)
      pending.add(operation)
      const remove = () => pending.delete(operation)
      void operation.then(remove, remove)
      return operation
    },
    async drain() {
      while (pending.size) await Promise.allSettled([...pending])
    },
  }
}

/** Owns exactly the IPC registrations it creates. Observation callbacks stay separate. */
export function bindCommandIpc(ipcMain, gate, { allowRead = () => false } = {}) {
  const channels = []
  const listeners = []
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => allowRead(channel, args)
        ? handler(event, ...args) : gate.run(() => handler(event, ...args)))
      channels.push(channel)
    },
    on(channel, handler) {
      const listener = (event, ...args) => {
        if (!gate.accepting) return
        void gate.run(() => handler(event, ...args)).catch((error) => console.error(`[IPC ${channel}]`, error))
      }
      ipcMain.on(channel, listener)
      listeners.push([channel, listener])
    },
    dispose() {
      channels.splice(0).forEach((channel) => ipcMain.removeHandler(channel))
      listeners.splice(0).forEach(([channel, listener]) => ipcMain.removeListener(channel, listener))
    },
  }
}
