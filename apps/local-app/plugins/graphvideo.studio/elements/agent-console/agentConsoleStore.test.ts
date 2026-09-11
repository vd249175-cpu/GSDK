import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentConsoleStore } from './agentConsoleStore'

const mockAgentHost = {
  discover: vi.fn(async () => [
    {
      id: 'default',
      name: 'Default Template',
      agents: [
        { id: 'director', name: 'Director' },
        { id: 'general', name: 'General Assistant' },
      ],
    },
    {
      id: 'advanced',
      name: 'Advanced Template',
      agents: [
        { id: 'researcher', name: 'Researcher' },
      ],
    },
  ]),
  launchTerminal: vi.fn(async (templateId: string, agentId: string) => ({
    templateId,
    agentId,
    title: agentId,
    terminal: 'windows-terminal' as const,
  })),
  openDirectory: vi.fn(async () => undefined),
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('AgentConsoleStore', () => {
  it('discovers templates on creation and sets initial selection', async () => {
    const store = new AgentConsoleStore('test-instance', mockAgentHost as never)
    await Promise.resolve()
    await Promise.resolve()

    const snapshot = store.getSnapshot()
    expect(snapshot.templates).toHaveLength(2)
    expect(snapshot.templateId).toBe('default')
    expect(snapshot.agentId).toBe('director')
    expect(snapshot.launches).toHaveLength(0)
    expect(snapshot.launching).toBe(false)
    expect(snapshot.error).toBe('')

    store.dispose()
  })

  it('updates selection when changing template and agent', async () => {
    const store = new AgentConsoleStore('test-instance', mockAgentHost as never)
    await Promise.resolve()
    await Promise.resolve()

    store.setTemplate('advanced')
    expect(store.getSnapshot().templateId).toBe('advanced')
    expect(store.getSnapshot().agentId).toBe('researcher')

    store.setTemplate('default')
    store.setAgent('general')
    expect(store.getSnapshot().templateId).toBe('default')
    expect(store.getSnapshot().agentId).toBe('general')

    store.dispose()
  })

  it('launches native terminal and records launch history', async () => {
    const store = new AgentConsoleStore('test-instance', mockAgentHost as never)
    await Promise.resolve()
    await Promise.resolve()

    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    const record = await store.launchTerminal()
    expect(record).toBeDefined()
    expect(record?.templateId).toBe('default')
    expect(record?.agentId).toBe('director')
    expect(record?.terminal).toBe('windows-terminal')
    expect(record?.launchedAt).toBeTypeOf('number')

    expect(mockAgentHost.launchTerminal).toHaveBeenCalledWith('default', 'director')
    expect(store.getSnapshot().launches).toHaveLength(1)
    expect(store.getSnapshot().lastLaunch).toEqual(record)
    expect(listener).toHaveBeenCalled()

    unsubscribe()
    store.dispose()
  })

  it('handles launchTerminal error gracefully', async () => {
    mockAgentHost.launchTerminal.mockRejectedValueOnce(new Error('wt.exe not found'))
    const store = new AgentConsoleStore('test-instance', mockAgentHost as never)
    await Promise.resolve()
    await Promise.resolve()

    const record = await store.launchTerminal()
    expect(record).toBeUndefined()
    expect(store.getSnapshot().error).toBe('wt.exe not found')
    expect(store.getSnapshot().launching).toBe(false)

    store.clearError()
    expect(store.getSnapshot().error).toBe('')

    store.dispose()
  })

  it('invokes openDirectory on the agent host', async () => {
    const store = new AgentConsoleStore('test-instance', mockAgentHost as never)
    await Promise.resolve()
    await Promise.resolve()

    await store.openDirectory()
    expect(mockAgentHost.openDirectory).toHaveBeenCalledWith('default', 'director')

    store.dispose()
  })

  it('allows dismissing launch records', async () => {
    const store = new AgentConsoleStore('test-instance', mockAgentHost as never)
    await Promise.resolve()
    await Promise.resolve()

    const record = await store.launchTerminal()
    expect(store.getSnapshot().launches).toHaveLength(1)

    if (record) {
      store.dismissLaunch(record.id)
      expect(store.getSnapshot().launches).toHaveLength(0)
    }

    store.dispose()
  })
})
