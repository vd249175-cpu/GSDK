import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createWindowsStepRecorder,
  readPsrArchive,
  startPsrProcess,
  stopPsrProcess,
  windowsSystemExecutable,
} from './windows-step-recorder.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Windows Steps Recorder bridge for Microsoft UFO', () => {
  it('pins Windows tools to System32 instead of the Git Bash PATH', () => {
    expect(windowsSystemExecutable('tar.exe', { WINDIR: 'D:\\Windows' }))
      .toBe('D:\\Windows\\System32\\tar.exe')
  })

  it('starts PSR without Windows detached mode', async () => {
    const child = new EventEmitter()
    child.unref = () => {}
    let spawnOptions
    const started = startPsrProcess({
      executable: 'C:\\Windows\\System32\\psr.exe',
      artifactPath: 'C:\\recordings\\session.zip',
    }, {
      spawnProcess: (_executable, _args, options) => {
        spawnOptions = options
        queueMicrotask(() => child.emit('spawn'))
        return child
      },
    })

    await started
    expect(spawnOptions).toEqual({ stdio: 'ignore', windowsHide: true })
    expect(spawnOptions).not.toHaveProperty('detached')
  })

  it('falls back to Windows ShellExecute when direct PSR start is denied', async () => {
    const child = new EventEmitter()
    child.unref = () => {}
    const shellCalls = []
    const started = startPsrProcess({
      executable: 'C:\\Windows\\System32\\psr.exe',
      artifactPath: 'C:\\recordings\\session.zip',
    }, {
      spawnProcess: () => {
        queueMicrotask(() => child.emit('error', Object.assign(new Error('denied'), { code: 'EACCES' })))
        return child
      },
      execProcess: async (...args) => shellCalls.push(args),
      environment: { WINDIR: 'C:\\Windows' },
    })

    await started
    expect(shellCalls).toHaveLength(1)
    expect(shellCalls[0][0]).toBe('C:\\Windows\\System32\\rundll32.exe')
    expect(shellCalls[0][1]).toEqual([
      'shell32.dll,ShellExec_RunDLL',
      'C:\\Windows\\System32\\psr.exe',
      '/start', '/output', 'C:\\recordings\\session.zip',
      '/sc', '1', '/gui', '0', '/arcxml', '1', '/maxsc', '100',
    ])
  })

  it('falls back to Windows ShellExecute when direct PSR stop is denied', async () => {
    const calls = []
    await stopPsrProcess({ executable: 'C:\\Windows\\System32\\psr.exe' }, {
      execProcess: async (...args) => {
        calls.push(args)
        if (calls.length === 1) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      },
      environment: { WINDIR: 'C:\\Windows' },
    })

    expect(calls).toHaveLength(2)
    expect(calls[1][0]).toBe('C:\\Windows\\System32\\rundll32.exe')
    expect(calls[1][1]).toEqual([
      'shell32.dll,ShellExec_RunDLL',
      'C:\\Windows\\System32\\psr.exe',
      '/stop',
    ])
  })

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
