import { createNativeGraphHost } from '@graphframework/desktop/graph-host'
export function createCounterHost(options) {
  const host = createNativeGraphHost(options)
  return Object.assign(host, {
    readCounter: () => host.readNodeState('example.counter') ?? { count: 0 },
    async injectCounter() {
      await host.injectRoot('example.counter', { type: 'IncrementInfo' })
      return this.readCounter()
    },
  })
}
