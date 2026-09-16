import { describe, expect, it } from 'vitest'
import { ElementStateRegistry } from './stateRegistry'

describe('Element state scopes', () => {
  it('builds application, project, workspace, and instance cells independently', () => {
    const states = new ElementStateRegistry()
    states.replaceOwner('editor', [
      { id: 'application', scope: 'application', initialValue: 0 },
      { id: 'project', scope: 'project', initialValue: 0 },
      { id: 'workspace', scope: 'workspace', initialValue: 0 },
      { id: 'instance', scope: 'instance', initialValue: 0 },
    ])
    const first = { projectId: 'a', workspaceId: 'editing', instanceId: 'shared' }
    const second = { projectId: 'b', workspaceId: 'review', instanceId: 'isolated' }

    states.bind<number>('editor', 'application', first).write(1)
    expect(states.bind<number>('editor', 'application', second).read()).toBe(1)
    states.bind<number>('editor', 'project', first).write(2)
    expect(states.bind<number>('editor', 'project', second).read()).toBe(0)
    states.bind<number>('editor', 'workspace', first).write(3)
    expect(states.bind<number>('editor', 'workspace', second).read()).toBe(0)
    states.bind<number>('editor', 'instance', first).write(4)
    expect(states.bind<number>('editor', 'instance', second).read()).toBe(0)
  })

  it('keeps cells for the current session after definitions are removed', () => {
    const states = new ElementStateRegistry()
    const definition = { id: 'selection', scope: 'instance' as const, initialValue: '' }
    states.replaceOwner('editor', [definition])
    states.bind<string>('editor', 'selection', { instanceId: 'shared' }).write('node-a')
    states.unregisterOwner('editor')
    states.replaceOwner('editor', [definition])
    expect(states.bind<string>('editor', 'selection', { instanceId: 'shared' }).read())
      .toBe('node-a')
  })
})
