import { describe, expect, it } from 'vitest'
import {locateNativeBinding} from '@graphvideo/sdk/node'
import studioPlugin from '../backend.ts'
import { createEmptyNativeGraphHost } from '@graphvideo/desktop/graph-host'

describe.skipIf(!locateNativeBinding())('native desktop lifecycle', () => {
  it('validates lifecycle sends against actual mounted instances', async () => {
    const host = createEmptyNativeGraphHost({ plugins: [studioPlugin] })
    await host.mountPlugins()
    try {
      const report = await host.space.analyze({ op: 'validate' })
      expect(report.valid, JSON.stringify(report)).toBe(true)
    } finally { await host.dispose() }
  })
  it('settles start and close through the Rust scheduler, including an OS close event during the effect', async () => {
    let host
    const calls = []
    const adapter = {
      id: 'test/electron-window',
      async execute(request) {
        calls.push(request.type)
        if (request.type === 'CLOSE') {
          host.space.injectRoot('src-electron-window', { type: 'ElectronWindowClosedObservedInfo' })
        }
        return { type: request.type === 'OPEN' ? 'OPENED' : 'CLOSED', isWindowOpen: request.type === 'OPEN' }
      },
    }
    host = createEmptyNativeGraphHost({ plugins: [studioPlugin], dependencies: { electronWindowAdapter: adapter } })
    await host.mountPlugins()
    try {
      const start = host.space.injectRoot('host-el', { type: 'DesktopStartRequestedInfo' })
      await host.space.waitForSubmission(start)
      expect(host.readNodeState('host-el').isWindowOpen).toBe(true)

      const close = host.space.injectRoot('host-el', { type: 'DesktopCloseRequestedInfo' })
      await host.space.waitForSubmission(close)
      expect(calls).toEqual(['OPEN', 'CLOSE'])
      expect(host.readNodeState('host-el').isWindowOpen).toBe(false)
    } finally {
      await host.dispose()
    }
  })
})
