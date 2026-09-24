import { createGraphToolPorts, defineGraphTool } from '../../../app/plugins/backend/agent-executor/bridge/graph-tool.mjs'

export { createGraphToolPorts, defineGraphTool }
export const createToolPorts = createGraphToolPorts

export function createNoteTool() {
  const notes = new Map()
  return defineGraphTool({
    name: 'record_note',
    description: 'Record one short key and value for this conversation. This tool does not edit files or run programs.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short note name' },
        value: { type: 'string', description: 'Text to remember' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    execute: async ({ threadId, toolCallId, args }) => {
      if (typeof args?.key !== 'string' || !args.key.trim() || args.key.length > 80
        || typeof args?.value !== 'string' || args.value.length > 4000) {
        throw new Error('record_note requires a key of 1–80 characters and a value of at most 4000 characters')
      }
      const handle = `${threadId}:${toolCallId}`
      const existing = notes.get(handle)
      if (existing && (existing.key !== args.key || existing.value !== args.value)) {
        throw new Error('Conflicting repeated tool call')
      }
      notes.set(handle, { key: args.key, value: args.value })
      return { handle }
    },
    observe: async ({ handle }) => {
      const note = notes.get(handle)
      if (!note) throw new Error('Note handle was not found')
      return { ...note }
    },
  })
}
