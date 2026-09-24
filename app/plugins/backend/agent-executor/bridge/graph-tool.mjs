// LangChain `tool()` equivalent for our architecture: defines model-visible
// metadata plus host-side execute/observe ports. execute() only commits the
// action and returns an opaque handle; observe() reads the fact. Graph nodes
// never see tool internals.

const validName = (value) => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)

export function defineGraphTool({ name, description, parameters, execute, observe }) {
  if (!validName(name)) throw new Error('Tool name must match [A-Za-z][A-Za-z0-9_]{0,63}')
  if (typeof description !== 'string' || !description.trim()) throw new Error(`Tool ${name} needs a description`)
  if (typeof execute !== 'function' || typeof observe !== 'function') {
    throw new Error(`Tool ${name} needs execute and observe ports`)
  }
  return { name, description, parameters, execute, observe }
}

export function createGraphToolPorts(templates) {
  const registry = new Map()
  for (const template of templates) {
    const tool = defineGraphTool(template)
    if (registry.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`)
    registry.set(tool.name, tool)
  }
  const findTool = (name) => {
    const tool = registry.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    return tool
  }
  return {
    definitions: [...registry.values()].map(({ name, description, parameters }) => ({ name, description, parameters })),
    toolExecution: {
      id: 'agent/tool-execution',
      execute: async (request) => findTool(request.toolName).execute(request),
    },
    toolObservation: {
      id: 'agent/tool-observation',
      execute: async (request) => findTool(request.toolName).observe(request),
    },
  }
}

export function createNoteTool() {
  const notes = new Map()
  return defineGraphTool({
    name: 'record_note',
    description: 'Record one short key and value for this conversation.',
    parameters: { type: 'object', properties: {
      key: { type: 'string' }, value: { type: 'string' },
    }, required: ['key', 'value'], additionalProperties: false },
    execute: async ({ threadId, toolCallId, args }) => {
      if (typeof args?.key !== 'string' || !args.key.trim() || args.key.length > 80
        || typeof args?.value !== 'string' || args.value.length > 4000) {
        throw new Error('record_note requires a short key and a value of at most 4000 characters')
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
