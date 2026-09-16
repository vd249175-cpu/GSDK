import { SquareTerminal } from 'lucide-react'
import { defineElement } from '@graphvideo/client-sdk'
import { AgentConsolePanel } from './AgentConsolePanel'
import { AgentConsoleStore } from './agentConsoleStore'
import './agent.css'

export default defineElement({
  register(context) {
    if (!context.application) throw new Error('Agent Console 缺少 ApplicationClient')
    const agent = context.application.agent
    context.runtime.define({
      create({ instanceId }) {
        const store = new AgentConsoleStore(instanceId, agent)
        return { store, dispose: () => store.dispose() }
      },
    })
    context.panels.register({
      id: 'agent-console',
      title: 'Agent 终端',
      icon: SquareTerminal,
      component: AgentConsolePanel,
    })
  },
})
