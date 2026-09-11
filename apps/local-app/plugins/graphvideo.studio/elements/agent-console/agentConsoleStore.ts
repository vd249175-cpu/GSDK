import type { GraphVideoApplicationClient } from '@graphvideo/client-sdk'
import type {
  AgentTemplateDto,
  AgentTerminalLaunchDto,
} from '@graphvideo/contracts'

export interface AgentConsoleLaunchRecord extends AgentTerminalLaunchDto {
  id: string
  launchedAt: number
}

export interface AgentConsoleSnapshot {
  templates: AgentTemplateDto[]
  templateId: string
  agentId: string
  launches: AgentConsoleLaunchRecord[]
  lastLaunch?: AgentConsoleLaunchRecord
  launching: boolean
  error: string
}

export class AgentConsoleStore {
  private snapshot: AgentConsoleSnapshot = {
    templates: [],
    templateId: '',
    agentId: '',
    launches: [],
    launching: false,
    error: '',
  }
  private readonly listeners = new Set<() => void>()
  private disposed = false

  constructor(
    readonly instanceId: string,
    private readonly agentHost: GraphVideoApplicationClient['agent'],
  ) {
    void agentHost.discover()
      .then((templates) => {
        this.update((current) => {
          const firstTemplate = templates[0]
          const firstAgent = firstTemplate?.agents[0]
          return {
            ...current,
            templates,
            templateId: current.templateId || firstTemplate?.id || '',
            agentId: current.agentId || firstAgent?.id || '',
          }
        })
      })
      .catch((reason) => this.setError(reason, '无法读取 Agent 模板'))
  }

  readonly getSnapshot = () => this.snapshot

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setTemplate(templateId: string) {
    this.update((current) => {
      const template = current.templates.find((item) => item.id === templateId)
      const firstAgent = template?.agents[0]
      return {
        ...current,
        templateId,
        agentId: firstAgent?.id ?? '',
      }
    })
  }

  setAgent(agentId: string) {
    this.update((current) => ({ ...current, agentId }))
  }

  clearError() {
    this.update((current) => ({ ...current, error: '' }))
  }

  dismissLaunch(launchId: string) {
    this.update((current) => ({
      ...current,
      launches: current.launches.filter((item) => item.id !== launchId),
      lastLaunch: current.lastLaunch?.id === launchId ? undefined : current.lastLaunch,
    }))
  }

  async launchTerminal(): Promise<AgentConsoleLaunchRecord | undefined> {
    const template = this.snapshot.templates.find((item) => item.id === this.snapshot.templateId)
      ?? this.snapshot.templates[0]
    const agent = template?.agents.find((item) => item.id === this.snapshot.agentId)
      ?? template?.agents[0]
    if (!template || !agent || this.snapshot.launching) return undefined

    this.update((current) => ({ ...current, launching: true, error: '' }))
    try {
      const result = await this.agentHost.launchTerminal(template.id, agent.id)
      const record: AgentConsoleLaunchRecord = {
        ...result,
        id: `launch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        launchedAt: Date.now(),
      }
      this.update((current) => ({
        ...current,
        launches: [record, ...current.launches.slice(0, 49)],
        lastLaunch: record,
      }))
      return record
    } catch (reason) {
      this.setError(reason, '无法启动原生终端')
      return undefined
    } finally {
      this.update((current) => ({ ...current, launching: false }))
    }
  }

  async openDirectory(): Promise<void> {
    const template = this.snapshot.templates.find((item) => item.id === this.snapshot.templateId)
      ?? this.snapshot.templates[0]
    const agent = template?.agents.find((item) => item.id === this.snapshot.agentId)
      ?? template?.agents[0]
    if (!template || !agent) return
    try {
      await this.agentHost.openDirectory(template.id, agent.id)
    } catch (reason) {
      this.setError(reason, '无法打开 Agent 目录')
    }
  }

  private setError(reason: unknown, fallback: string) {
    const error = reason instanceof Error ? reason.message : fallback
    this.update((current) => ({ ...current, error }))
  }

  private update(updateSnapshot: (current: AgentConsoleSnapshot) => AgentConsoleSnapshot) {
    if (this.disposed) return
    this.snapshot = updateSnapshot(this.snapshot)
    this.listeners.forEach((listener) => listener())
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.listeners.clear()
  }
}
