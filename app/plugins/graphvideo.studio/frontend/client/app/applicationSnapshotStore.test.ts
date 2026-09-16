import { describe, expect, it } from 'vitest'
import { createInitialState } from '../../core/state/initialState'
import { ApplicationHost } from '../../application/host/applicationHost'
import { InProcessTransport } from '../../application/transport/inProcessTransport'
import { ApplicationSnapshotStore } from './applicationClient'

describe('ApplicationSnapshotStore', () => {
  it('keeps client mutations outside authoritative application state', async () => {
    const authoritative = {
      revision: 1,
      state: createInitialState(),
      history: { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, revision: 0 },
    }
    const host = new ApplicationHost()
    host.register('snapshot.read', () => authoritative)
    const transport = new InProcessTransport(host)
    const store = new ApplicationSnapshotStore(transport, structuredClone(authoritative))
    store.readState().project.name = 'client mutation'
    await store.refresh()
    expect(authoritative.state.project.name).toBe('未打开项目')
    expect(store.readState().project.name).toBe('未打开项目')
    store.dispose()
  })
})
