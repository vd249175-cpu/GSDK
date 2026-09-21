/**
 * runs/unified-recorder/host.mjs — 统一录制 run 宿主：向 unified 图注入双源 Adapter。
 */

import { dirname, join } from 'node:path'
import { createRunCli, createUnifiedAdapters } from './bridge/unified-adapters.mjs'

export async function createRunHost({ runtimeDirectory, parsed } = {}) {
  const runCli = createRunCli()
  const dataDirectory = runtimeDirectory ? join(dirname(runtimeDirectory), 'data') : '.generated/data'
  const recordingsDirectory = join(dataDirectory, 'recordings')

  const adapters = createUnifiedAdapters({
    runCli,
    cliSession: parsed?.backend?.dependencies?.cliSession ?? 'rec',
    cdpUrl: parsed?.backend?.dependencies?.cdpUrl ?? 'http://127.0.0.1:9343',
    pythonExecutable: parsed?.backend?.dependencies?.pythonExecutable ?? 'python.exe',
    recordingsDirectory,
  })

  return {
    dependenciesFor: {
      desktopControl: adapters.desktopControl,
      browserControl: adapters.browserControl,
      desktopObservation: adapters.desktopObservation,
      desktopEvents: adapters.desktopEvents,
      browserEvents: adapters.browserEvents,
    },
    hostRoots: [
      {
        frontendId: 'recorder-ui',
        targetNodeId: 'recorder/observation',
        infoType: 'PollUnifiedEventsInfo',
      },
    ],
  }
}
