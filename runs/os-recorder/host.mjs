/**
 * Run-scoped physical host for the Microsoft UFO-compatible desktop recorder.
 * The Graph nodes receive only EffectAdapters; process and filesystem access
 * remain outside the causal microkernel.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWindowsStepRecorder } from './bridge/windows-step-recorder.mjs'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))

export async function createRunHost({ runtimeDirectory } = {}) {
  if (!runtimeDirectory) throw new Error('os-recorder host requires runtimeDirectory')

  const bridge = createWindowsStepRecorder({
    recordingsDirectory: join(dirname(runtimeDirectory), 'data', 'recordings'),
    ufoDirectory: join(repositoryRoot, 'packages', 'ufo'),
  })

  return {
    dependenciesFor: {
      captureControl: bridge.captureControl,
      captureObservation: bridge.captureObservation,
    },
    stopSources: bridge.stopActive,
  }
}
