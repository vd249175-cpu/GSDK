/**
 * runs/main/host.mjs — 统一生产主 run 宿主：向多图实例按需注入物理世界 Adapters。
 *
 * 架构规范：
 * - 纯领域 Node 零 I/O；
 * - 物理系统 (Chrome CDP, Windows Steps Recorder, Microsoft UFO UIA) 均通过宿主构造注入；
 * - 依据 instance.id / plugin 精准分发依赖，彻底避免 Adapter 命名冲突。
 */

import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCdpRecorder } from '../../app/plugins/backend/browser-recorder/index.mjs'
import {
  createWindowsInputEventSource,
  createWindowsStepRecorder,
} from '../../app/plugins/backend/os-recorder/index.mjs'
import { createUfoComputerBridge } from '../../app/plugins/backend/ufo-computer-control/index.mjs'
import {
  createRunCli,
  createUnifiedAdapters,
} from '../../app/plugins/backend/unified-recorder/bridge/unified-adapters.mjs'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))

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
      await osBridge.stopActive?.()
      await computer.stop?.()
    },
  }
}

