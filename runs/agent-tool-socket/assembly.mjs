export default {
  id: 'agent-tool-socket.main',
  contribute(run) {
    run.backendPlugin({ id: 'example.agent-executor', path: '../../app/plugins/backend/agent-executor' })
    run.backendPlugin({ id: 'example.agent-monitor', path: '../../app/plugins/backend/agent-monitor' })
    run.graph({ id: 'agent', plugin: 'example.agent-executor', factory: 'createAgentExecutorGraph',
      params: { promptSections: ['You are a GraphFramework agent. Use only the listed graph tools.'] } })
    run.graph({ id: 'monitor', plugin: 'example.agent-monitor', factory: 'createAgentMonitorGraph' })
    run.requireNode('agent/session')
    run.requireNode('monitor/session')
  },
}
