import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createWindowsStepRecorder,
  readPsrArchive,
} from './windows-step-recorder.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Windows Steps Recorder bridge for Microsoft UFO', () => {
  it('parses the upstream UFO sample demonstration archive', async () => {
    const sample = resolve('packages/ufo/record_processor/example/sample_record.zip')
    const parsed = await readPsrArchive(sample)
    expect(parsed.events).toHaveLength(7)
    expect(parsed.events[0]).toMatchObject({
      index: 1,
      action: 'Mouse Left Click',
      application: 'MSEDGEWEBVIEW2.EXE',
    })
    expect(parsed.events.some((event) => event.action === 'Keyboard Input')).toBe(true)
    expect(parsed.applications).toContain('MSEDGEWEBVIEW2.EXE')
  })

  it('creates a recording artifact and observes it through separate adapters', async () => {
    const output = await mkdtemp(join(tmpdir(), 'gvsdk-os-recorder-test-'))
    temporaryDirectories.push(output)
    const sample = resolve('packages/ufo/record_processor/example/sample_record.zip')
    const calls = []
    const bridge = createWindowsStepRecorder({
      recordingsDirectory: output,
      ufoDirectory: resolve('packages/ufo'),
      executable: resolve('packages/ufo/LICENSE'),
      platform: 'win32',
      clock: () => '2026-09-20T08:00:00.000Z',
      startProcess: async ({ artifactPath }) => calls.push({ op: 'start', artifactPath }),
      stopProcess: async ({ artifactPath }) => {
        calls.push({ op: 'stop', artifactPath })
        await copyFile(sample, artifactPath)
      },
    })

    const started = await bridge.captureControl.execute({ op: 'start', sessionId: 'desktop demo' })
    expect(started.handle).toBe('psr:desktop demo')
    expect(started.artifactPath).toContain('desktop-demo-2026-09-20T08-00-00-000Z.zip')

    const stopped = await bridge.captureControl.execute({ op: 'stop', sessionId: 'desktop demo' })
    const observed = await bridge.captureObservation.execute({
      op: 'observe',
      sessionId: 'desktop demo',
      artifactPath: stopped.artifactPath,
    })
    expect(calls.map((call) => call.op)).toEqual(['start', 'stop'])
    expect(observed.events).toHaveLength(7)
    expect(observed.applications).toContain('MSEDGEWEBVIEW2.EXE')
  })

  it('rejects artifacts outside the configured recording directory', async () => {
    const output = await mkdtemp(join(tmpdir(), 'gvsdk-os-recorder-test-'))
    temporaryDirectories.push(output)
    const bridge = createWindowsStepRecorder({
      recordingsDirectory: output,
      ufoDirectory: resolve('packages/ufo'),
      executable: resolve('packages/ufo/LICENSE'),
      platform: 'win32',
    })
    await expect(bridge.captureObservation.execute({
      op: 'observe',
      artifactPath: resolve('packages/ufo/record_processor/example/sample_record.zip'),
    })).rejects.toThrow('escaped')
  })
})
