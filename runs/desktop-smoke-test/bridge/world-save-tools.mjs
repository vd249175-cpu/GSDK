import { defineGraphTool } from '../../../app/plugins/backend/agent-executor/bridge/graph-tool.mjs'

export function createWorldSaveTools({ showDecision, readPending, inject }) {
  const observations = new Map()
  const decisions = new Map()
  const receipts = new Map()
  const keyFor = (threadId, requestId) => `${threadId}:${requestId}`

  const ask = defineGraphTool({
    name: 'ask_world_save',
    description: 'Ask the user whether to save a world document for the completed test. Wait for the actual decision.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async ({ threadId, requestId, toolCallId }) => {
      const handle = keyFor(threadId, toolCallId)
      if (observations.has(handle)) return { handle }
      const pending = await readPending()
      if (pending?.requestId !== requestId || pending?.step !== 'save-world') {
        throw new Error('world save request is no longer pending')
      }
      const response = await showDecision(pending)
      if (!response?.cancelled && (response?.nodeId !== undefined && response.nodeId !== pending.nodeId
        || response?.requestId !== requestId || response?.step !== 'save-world'
        || !['approve', 'reject'].includes(response?.decision))) {
        throw new Error('popup returned a stale or invalid decision')
      }
      observations.set(handle, response?.cancelled ? { cancelled: true } : {
        decision: response.decision, text: typeof response.text === 'string' ? response.text : '',
      })
      return { handle }
    },
    observe: async ({ handle, threadId, requestId }) => {
      const result = observations.get(handle)
      if (!result) throw new Error('world save decision is missing')
      if (!result.cancelled) decisions.set(keyFor(threadId, requestId), result)
      return result
    },
  })

  const signal = defineGraphTool({
    name: 'signal_world_save',
    description: 'Send the user’s observed world-save choice to the workflow. Call only after ask_world_save returns a decision.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: async ({ threadId, requestId, toolCallId }) => {
      const handle = keyFor(threadId, toolCallId)
      if (receipts.has(handle)) return { handle }
      const decision = decisions.get(keyFor(threadId, requestId))
      if (!decision) throw new Error('user decision is required before world save signal')
      const pending = await readPending()
      if (pending?.requestId !== requestId || pending?.step !== 'save-world') {
        throw new Error('world save request is no longer pending')
      }
      await inject(pending.nodeId, { type: 'WorldSaveDecisionInfo', requestId,
        decision: decision.decision, text: decision.text })
      receipts.set(handle, { signaled: true, decision: decision.decision })
      decisions.delete(keyFor(threadId, requestId))
      return { handle }
    },
    observe: async ({ handle }) => {
      const receipt = receipts.get(handle)
      if (!receipt) throw new Error('world save signal receipt is missing')
      return receipt
    },
  })
  return [ask, signal]
}
