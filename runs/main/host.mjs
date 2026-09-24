/**
 * runs/main/host.mjs — 统一生产主 run 宿主：向多图实例按需注入物理世界 Adapters。
 *
 * 架构规范：
 * - 纯领域 Node 零 I/O；
 * - 物理系统 (Chrome CDP, Windows Steps Recorder, Microsoft UFO UIA) 均通过宿主构造注入；
 * - 依据 instance.id / plugin 精准分发依赖，彻底避免 Adapter 命名冲突。
 */

import { execFile } from 'node:child_process'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createCdpRecorder } from '../../app/plugins/backend/browser-recorder/index.mjs'
import {
  createWindowsInputEventSource,
  createWindowsStepRecorder,
} from '../../app/plugins/backend/os-recorder/index.mjs'
import { createUfoComputerBridge } from '../../app/plugins/backend/ufo-computer-control/index.mjs'
import { createBrowserExecutor, checkHomeTask } from '../../app/plugins/backend/browser-executor/bridge/browser-executor.mjs'
import { createPythonAgentBridge } from '../../app/plugins/backend/agent-executor/bridge/process-bridge.mjs'
import { resolveAgentModelConfig } from '../../app/plugins/backend/agent-executor/bridge/model-config.mjs'
import { createGraphToolPorts, createNoteTool } from '../../app/plugins/backend/agent-executor/bridge/graph-tool.mjs'
import {
  createRunCli,
  createUnifiedAdapters,
} from '../../app/plugins/backend/unified-recorder/bridge/unified-adapters.mjs'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const execFileAsync = promisify(execFile)
const browserScript = join(repositoryRoot, '.agents', 'skills', 'browser-setup', 'scripts', 'browser.ps1')
const agentWorkerScript = join(repositoryRoot, 'app', 'plugins', 'backend', 'agent-executor', 'bridge', 'worker.py')

export async function createRunHost({ runtimeDirectory, parsed } = {}) {
  if (!runtimeDirectory) throw new Error('main host requires runtimeDirectory')

  const dataDirectory = runtimeDirectory ? join(dirname(runtimeDirectory), 'data') : '.generated/data'
  const recordingsDirectory = join(dataDirectory, 'recordings')

  // 1. 浏览器录制 CDP Adapter
  const cdpUrl = parsed?.backend?.dependencies?.cdpUrl ?? 'http://127.0.0.1:9343'
  const cdpRecorder = createCdpRecorder({ cdpUrl })

  // 2. 操作系统录制 PSR / Live Input Adapter
  const configuredUfoDirectory = parsed?.backend?.dependencies?.ufoDirectory ?? '../../packages/ufo'
  const ufoDirectory = isAbsolute(configuredUfoDirectory)
    ? configuredUfoDirectory
    : resolve(dirname(parsed.configPath), configuredUfoDirectory)
  const configuredUfoPython = parsed?.backend?.dependencies?.ufoPythonExecutable
    ?? join(ufoDirectory, '.venv', 'Scripts', 'python.exe')
  const ufoPythonExecutable = isAbsolute(configuredUfoPython)
    ? configuredUfoPython
    : resolve(dirname(parsed.configPath), configuredUfoPython)

  const osBridge = createWindowsStepRecorder({
    recordingsDirectory,
    ufoDirectory,
    liveEventSource: createWindowsInputEventSource({
      observerScript: join(repositoryRoot, 'app', 'plugins', 'backend', 'os-recorder', 'bridge', 'windows-input-observer.py'),
      pythonExecutable: parsed?.backend?.dependencies?.pythonExecutable ?? 'python.exe',
    }),
  })

  // 3. UFO Agent 操作系统控制 Adapter
  const computer = createUfoComputerBridge({
    pythonExecutable: ufoPythonExecutable,
    workerScript: join(repositoryRoot, 'app', 'plugins', 'backend', 'ufo-computer-control', 'bridge', 'ufo-computer-worker.py'),
    ufoDirectory,
    screenshotsDirectory: join(dataDirectory, 'ufo-observations'),
  })

  const browser = createBrowserExecutor({
    cdpUrl,
    ensureBrowser: async () => {
      if (process.platform !== 'win32') throw new Error('dedicated browser requires Windows')
      await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', browserScript, '-Action', 'Start'], { windowsHide: true, timeout: 30000 })
    },
    tasks: { 'check-home': checkHomeTask },
  })
  const agentTools = createGraphToolPorts([createNoteTool()])
  const agentModelConfig = resolveAgentModelConfig({ model: parsed?.backend?.dependencies?.agentModel,
    baseUrl: parsed?.backend?.dependencies?.agentBaseUrl })
  const agentBridge = createPythonAgentBridge({
    workerScript: agentWorkerScript,
    sqliteDirectory: join(dataDirectory, 'agent-threads'),
    pythonExecutable: parsed?.backend?.dependencies?.agentPythonExecutable ?? 'python',
    ...agentModelConfig,
    toolDefinitions: agentTools.definitions,
  })

  // 4. 统一全态录制 (Unified Recorder) 双源 Adapter
  const runCli = createRunCli()
  const unifiedAdapters = createUnifiedAdapters({
    runCli,
    cliSession: parsed?.backend?.dependencies?.cliSession ?? 'rec',
    cdpUrl,
    pythonExecutable: parsed?.backend?.dependencies?.pythonExecutable ?? 'python.exe',
    recordingsDirectory,
    observerScript: join(repositoryRoot, 'app', 'plugins', 'backend', 'os-recorder', 'bridge', 'windows-input-observer.py'),
    enablePsr: process.platform === 'win32',
  })

  // 5. 录制中 live 事件 tick：宿主常驻时钟，只发 Info，不碰 State。
  // 前端保持无状态 projection 订阅；关窗口也不中断后端录制。
  const pollIntervalMs = Number(parsed?.backend?.dependencies?.unifiedPollIntervalMs ?? 1200)
  const pollInterval = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 1200
  let pollTimer = null
  let pollInject = null
  let pollInFlight = false
  const tickPoll = async () => {
    if (pollInFlight) return
    if (!pollInject || typeof pollInject.inject !== 'function' || typeof pollInject.projection !== 'function') return
    let projection = null
    try {
      projection = await pollInject.projection()
    } catch {
      return
    }
    const session = projection?.nodes?.['recorder/session']
    if (session?.state?.status !== 'recording') return
    const sessionId = session?.state?.sessionId
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    pollInFlight = true
    try {
      await pollInject.inject('recorder/observation', { type: 'PollUnifiedEventsInfo', sessionId })
    } catch {
      // 下一 tick 重试：不抛、不累积、不改 State。
    } finally {
      pollInFlight = false
    }
  }
  const startPolling = (hooks) => {
    agentBridge.setGraphHooks(hooks)
    if (pollTimer || !hooks || typeof hooks.inject !== 'function' || typeof hooks.projection !== 'function') return
    pollInject = hooks
    pollTimer = setInterval(() => { void tickPoll() }, pollInterval)
    pollTimer.unref?.()
  }
  const stopPolling = () => {
    agentBridge.setGraphHooks(null)
    clearInterval(pollTimer)
    pollTimer = null
    pollInject = null
    pollInFlight = false
  }
  return {
    dependenciesFor: (instance) => {
      if (instance.id === 'recorder' || instance.factory?.plugin === 'example.unified-recorder') {
        return {
          desktopControl: unifiedAdapters.desktopControl,
          browserControl: unifiedAdapters.browserControl,
          desktopObservation: unifiedAdapters.desktopObservation,
          desktopEvents: unifiedAdapters.desktopEvents,
          browserEvents: unifiedAdapters.browserEvents,
        }
      }
      if (instance.id === 'browser-recorder' || instance.factory?.plugin === 'example.browser-recorder') {
        return {
          captureControl: cdpRecorder.captureControl,
          captureEvents: cdpRecorder.captureEvents,
        }
      }
      if (instance.id === 'os-recorder' || instance.factory?.plugin === 'example.os-recorder') {
        return {
          captureControl: osBridge.captureControl,
          captureObservation: osBridge.captureObservation,
          captureEvents: osBridge.captureEvents,
        }
      }
      if (instance.id === 'computer' || instance.factory?.plugin === 'example.ufo-computer-control') {
        return {
          ufoComputerExecution: computer.executionAdapter,
          ufoComputerObservation: computer.observationAdapter,
        }
      }
      if (instance.id === 'browser') return { browserExecution: browser,
        browserObservation: { id: 'browser/observation', execute: () => browser.observe() } }
      if (instance.id === 'agent') return { runAgent: agentBridge.runAgent,
        graphToolExecution: agentTools.toolExecution,
        graphToolObservation: agentTools.toolObservation }
      return {}
    },
    hostRoots: [
      {
        frontendId: 'main-ui',
        targetNodeId: 'recorder/observation',
        infoType: 'PollUnifiedEventsInfo',
      },
    ],
     stopSources: async () => {
      stopPolling()
      await osBridge.stopActive?.()
      await computer.stop?.()
      await browser.dispose()
      await agentBridge.dispose()
    },
    dispose: async () => {
      stopPolling()
      await browser.dispose()
      await agentBridge.dispose()
    },
    startPolling,
    stopPolling,
  }
}
