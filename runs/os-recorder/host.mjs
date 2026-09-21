/**
 * Run-scoped physical host for the Microsoft UFO-compatible desktop recorder.
 * The Graph nodes receive only EffectAdapters; process and filesystem access
 * remain outside the causal microkernel.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createWindowsInputEventSource,
  createWindowsStepRecorder,
} from './bridge/windows-step-recorder.mjs'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))

export async function createRunHost({ runtimeDirectory, parsed } = {}) {
  if (!runtimeDirectory) throw new Error('os-recorder host requires runtimeDirectory')

  const bridge = createWindowsStepRecorder({
    recordingsDirectory: join(dirname(runtimeDirectory), 'data', 'recordings'),
    ufoDirectory: join(repositoryRoot, 'packages', 'ufo'),
    liveEventSource: createWindowsInputEventSource({
      observerScript: join(repositoryRoot, 'runs', 'os-recorder', 'bridge', 'windows-input-observer.py'),
      pythonExecutable: parsed?.backend?.dependencies?.pythonExecutable ?? 'python.exe',
    }),
  })

  return {
    dependenciesFor: {
      captureControl: bridge.captureControl,
      captureObservation: bridge.captureObservation,
      captureEvents: bridge.captureEvents,
    },
    hostRoots: [
      {
        frontendId: 'recorder-ui',
        targetNodeId: 'recorder/observation',
        infoType: 'PollRecordingEventsInfo',
      },
    ],
    stopSources: bridge.stopActive,
  }
}
