/**
 * Run-scoped physical host for the Microsoft UFO-compatible desktop recorder.
 * The Graph nodes receive only EffectAdapters; process and filesystem access
 * remain outside the causal microkernel.
 */

import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createWindowsInputEventSource,
  createWindowsStepRecorder,
} from './bridge/windows-step-recorder.mjs'
import { createUfoComputerBridge } from './bridge/ufo-computer-bridge.mjs'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))

export async function createRunHost({ runtimeDirectory, parsed } = {}) {
  if (!runtimeDirectory) throw new Error('os-recorder host requires runtimeDirectory')

  const configuredUfoDirectory = parsed?.backend?.dependencies?.ufoDirectory ?? '../../packages/ufo'
  const ufoDirectory = isAbsolute(configuredUfoDirectory)
    ? configuredUfoDirectory
    : resolve(dirname(parsed.configPath), configuredUfoDirectory)
  const configuredUfoPython = parsed?.backend?.dependencies?.ufoPythonExecutable
    ?? join(ufoDirectory, '.venv', 'Scripts', 'python.exe')
  const ufoPythonExecutable = isAbsolute(configuredUfoPython)
    ? configuredUfoPython
    : resolve(dirname(parsed.configPath), configuredUfoPython)

  const bridge = createWindowsStepRecorder({
    recordingsDirectory: join(dirname(runtimeDirectory), 'data', 'recordings'),
    ufoDirectory,
    liveEventSource: createWindowsInputEventSource({
      observerScript: join(repositoryRoot, 'runs', 'os-recorder', 'bridge', 'windows-input-observer.py'),
      pythonExecutable: parsed?.backend?.dependencies?.pythonExecutable ?? 'python.exe',
    }),
  })
  const computer = createUfoComputerBridge({
    pythonExecutable: ufoPythonExecutable,
    workerScript: join(repositoryRoot, 'runs', 'os-recorder', 'bridge', 'ufo-computer-worker.py'),
    ufoDirectory,
    screenshotsDirectory: join(dirname(runtimeDirectory), 'data', 'ufo-observations'),
  })

  return {
    dependenciesFor: {
      captureControl: bridge.captureControl,
      captureObservation: bridge.captureObservation,
      captureEvents: bridge.captureEvents,
      ufoComputerExecution: computer.executionAdapter,
      ufoComputerObservation: computer.observationAdapter,
    },
    hostRoots: [
      {
        frontendId: 'recorder-ui',
        targetNodeId: 'recorder/observation',
        infoType: 'PollRecordingEventsInfo',
      },
    ],
    stopSources: async () => {
      await bridge.stopActive()
      await computer.stop()
    },
  }
}
