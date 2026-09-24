import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPythonAgentBridge } from '../../app/plugins/backend/agent-executor/bridge/process-bridge.mjs'
import { createNoteTool, createToolPorts } from './bridge/tool-ports.mjs'

const workerScript = fileURLToPath(new URL('../../app/plugins/backend/agent-executor/bridge/worker.py', import.meta.url))

export async function createRunHost({ parsed, runtimeDirectory, tools, spawnWorker } = {}) {
  const ports = createToolPorts(tools ?? [createNoteTool()])
  const bridge = createPythonAgentBridge({
    workerScript, sqliteDirectory: join(runtimeDirectory ?? fileURLToPath(new URL('.generated/runtime', import.meta.url)), 'agent-threads'),
    pythonExecutable: parsed?.backend?.dependencies?.pythonExecutable ?? 'python',
    model: parsed?.backend?.dependencies?.model ?? 'qwen/qwen3-vl-30b-a3b-instruct',
    baseUrl: parsed?.backend?.dependencies?.baseUrl ?? 'https://openrouter.ai/api/v1',
    toolDefinitions: ports.definitions, spawnWorker,
  })
  return {
    dependenciesFor: (instance) => instance.id === 'agent' ? {
      runAgent: bridge.runAgent,
      graphToolExecution: ports.toolExecution,
      graphToolObservation: ports.toolObservation,
    } : {},
    startPolling: (hooks) => bridge.setGraphHooks(hooks),
    stopPolling: () => bridge.setGraphHooks(null),
    stopSources: () => bridge.dispose(),
    dispose: () => bridge.dispose(),
  }
}
