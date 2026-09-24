import { Node, defineBackendPlugin } from '@graphframework/sdk/plugin'

export class AgentMonitorNode extends Node {
  constructor(id) {
    super(id, 'AgentMonitor', { events: [], latestByThread: {} })
  }

  change(info, ctx) {
    if (info.type !== 'AgentMonitorInfo' || typeof info.threadId !== 'string'
      || typeof info.phase !== 'string') return
    const event = { threadId: info.threadId, requestId: info.requestId ?? null,
      phase: info.phase, toolName: info.toolName ?? null, toolCallId: info.toolCallId ?? null,
      messageCount: info.messageCount ?? null, error: info.error ?? null }
    ctx.patchState({ events: [...ctx.read('events').slice(-199), event],
      latestByThread: { ...ctx.read('latestByThread'), [info.threadId]: event } })
  }
}

export function createAgentMonitorGraph(ctx) {
  return [new AgentMonitorNode(ctx?.nodeIdFor?.('session') ?? `${ctx?.instanceId ?? 'monitor'}/session`)]
}
createAgentMonitorGraph.describe = () => ({ kind: 'graph', localIds: ['session'], requiredBindings: [], rendererRoots: [] })

export default defineBackendPlugin({ id: 'example.agent-monitor', createNodes: createAgentMonitorGraph, rendererRoots: [] })
