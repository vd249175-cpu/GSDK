import { spawn, execFile } from 'node:child_process'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))

const decodeXml = (value = '') => value
  .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')

const textOf = (body, tagName) => {
  const match = body.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'))
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, '').trim()) : null
}

const attributesOf = (source) => {
  const result = {}
  for (const match of source.matchAll(/([A-Za-z][\w:-]*)="([\s\S]*?)"/g)) {
    result[match[1]] = decodeXml(match[2])
  }
  return result
}

/** Parse the XML payload embedded in a Windows Steps Recorder MHT archive. */
export function parsePsrMht(content) {
  if (typeof content !== 'string' || !content.includes('<UserActionData>')) {
    throw new Error('The recording does not contain Windows Steps Recorder UserActionData')
  }

  const sessionMatch = content.match(/<RecordSession\b([^>]*)>/i)
  const session = sessionMatch ? attributesOf(sessionMatch[1]) : {}
  const events = []

  for (const match of content.matchAll(/<EachAction\b([^>]*)>([\s\S]*?)<\/EachAction>/gi)) {
    const attributes = attributesOf(match[1])
    const index = Number.parseInt(attributes.ActionNumber ?? `${events.length + 1}`, 10)
    events.push({
      index: Number.isFinite(index) ? index : events.length + 1,
      time: attributes.Time ?? null,
      application: attributes.FileName ?? null,
      applicationDescription: attributes.FileDescription ?? null,
      action: attributes.Action ?? textOf(match[2], 'Action'),
      description: textOf(match[2], 'Description'),
    })
  }

  const applications = [...new Set(events.map((event) => event.application).filter(Boolean))]

  return {
    session: {
      recordedAt: session.RecordedAt ?? null,
      osVersion: session.OSVersion ?? null,
      recordedProcesses: session.RecordedProcesses ?? null,
    },
    applications,
    events,
  }
}

export const windowsSystemExecutable = (
  executableName,
  environment = process.env,
) => join(environment.WINDIR ?? 'C:\\Windows', 'System32', executableName)

const findFirstMht = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(directory, entry.name)
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.mht') return fullPath
    if (entry.isDirectory()) {
      const nested = await findFirstMht(fullPath)
      if (nested) return nested
    }
  }
  return null
}

/** Read and parse a Windows Steps Recorder ZIP container using built-in Windows tar. */
export async function readPsrArchive(artifactPath, {
  tarExecutable = windowsSystemExecutable('tar.exe'),
  execProcess = execFileAsync,
} = {}) {
  await access(artifactPath, fsConstants.R_OK)
  const extractionDirectory = await mkdtemp(join(tmpdir(), 'psr-extract-'))
  try {
    await execProcess(tarExecutable, ['-xf', artifactPath, '-C', extractionDirectory], {
      windowsHide: true,
    })
    const mhtPath = await findFirstMht(extractionDirectory)
    if (!mhtPath) throw new Error(`No .mht recording found in ${basename(artifactPath)}`)
    return parsePsrMht(await readFile(mhtPath, 'utf8'))
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true })
  }
}

const waitForArtifact = async (artifactPath, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const details = await stat(artifactPath)
      if (details.isFile() && details.size > 0) return
    } catch {
      // PSR writes the archive asynchronously after /stop.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error(`Windows Steps Recorder did not create ${artifactPath}`)
}

const liveEventFrom = (input, index) => {
  const application = typeof input.application === 'string' ? input.application : null
  const windowTitle = typeof input.windowTitle === 'string' ? input.windowTitle : null
  const time = new Date(Number(input.timestamp) || Date.now()).toLocaleTimeString()
  if (input.kind === 'mouse') {
    const button = input.button === 'right' ? 'Right' : input.button === 'middle' ? 'Middle' : 'Left'
    return {
      index,
      time,
      application,
      applicationDescription: windowTitle,
      action: `Mouse ${button} Click`,
      description: windowTitle
        ? `User clicked in ${windowTitle} (${input.x}, ${input.y})`
        : `User clicked at (${input.x}, ${input.y})`,
    }
  }
  if (input.kind === 'scroll') {
    return {
      index,
      time,
      application,
      applicationDescription: windowTitle,
      action: 'Mouse Wheel Scroll',
      description: windowTitle
        ? `User scrolled ${input.axis} in ${windowTitle}`
        : `User scrolled ${input.axis}`,
    }
  }
  return {
    index,
    time,
    application,
    applicationDescription: windowTitle,
    action: 'Keyboard Input',
    description: windowTitle
      ? `User typed into ${windowTitle}`
      : 'User entered keyboard input',
  }
}

export function createWindowsInputEventSource({
  observerScript = resolve(fileURLToPath(new URL('.', import.meta.url)), 'windows-input-observer.py'),
  pythonExecutable = 'python.exe',
  spawnProcess = spawn,
  readyTimeoutMs = 10_000,
} = {}) {
  if (!observerScript) throw new Error('observerScript is required')
  let child = null
  let lines = null
  let queued = []
  let nextIndex = 1
  let stderr = ''

  const stop = async () => {
    if (!child) return
    const stoppingChild = child
    child = null
    const closed = new Promise((resolveClose) => stoppingChild.once('close', resolveClose))
    stoppingChild.stdin?.end()
    const result = await Promise.race([closed.then(() => 'closed'), delay(2_000).then(() => 'timeout')])
    if (result === 'timeout') {
      stoppingChild.kill()
      await Promise.race([closed, delay(1_000)])
    }
    lines?.close()
    lines = null
  }

  return {
    start: async () => {
      if (child) throw new Error('Windows input observer is already running')
      queued = []
      nextIndex = 1
      stderr = ''
      child = spawnProcess(pythonExecutable, ['-u', observerScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      const startingChild = child
      lines = createInterface({ input: startingChild.stdout })
      const ready = new Promise((resolveReady, rejectReady) => {
        const timeout = setTimeout(() => rejectReady(new Error('Windows input observer did not become ready')), readyTimeoutMs)
        const fail = (error) => {
          clearTimeout(timeout)
          rejectReady(error)
        }
        startingChild.once('error', fail)
        startingChild.once('exit', (code) => {
          if (child === startingChild) fail(new Error(`Windows input observer exited (${code}): ${stderr.trim()}`))
        })
        lines.once('line', (line) => {
          clearTimeout(timeout)
          try {
            const message = JSON.parse(line)
            if (message.type !== 'ready') throw new Error(message.message ?? 'Windows input observer failed to initialize')
            resolveReady()
          } catch (error) {
            rejectReady(error)
          }
        })
      })
      startingChild.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000) })
      lines.on('line', (line) => {
        try {
          const message = JSON.parse(line)
          if (message.type === 'input') queued.push(message)
        } catch {
          // A malformed observer line is ignored; later valid input remains usable.
        }
      })
      try {
        await ready
      } catch (error) {
        await stop()
        throw error
      }
    },
    poll: async () => {
      const batch = queued
      queued = []
      const events = []
      for (const input of batch) {
        const previous = events.at(-1)
        if (input.kind === 'keyboard' && previous?.action === 'Keyboard Input' && previous.application === input.application) {
          previous.time = new Date(Number(input.timestamp) || Date.now()).toLocaleTimeString()
          continue
        }
        events.push(liveEventFrom(input, nextIndex++))
      }
      return { events }
    },
    stop,
  }
}

const psrStartArguments = (artifactPath) => [
  '/start',
  '/output', artifactPath,
  '/sc', '1',
  '/gui', '0',
  '/arcxml', '1',
  '/maxsc', '100',
]

const spawnAndForget = (executable, arguments_, spawnProcess) => new Promise((resolveStart, rejectStart) => {
  const child = spawnProcess(executable, arguments_, {
    stdio: 'ignore',
    windowsHide: true,
  })
  child.once('error', rejectStart)
  child.once('spawn', () => {
    child.unref()
    resolveStart()
  })
})

const shellExecuteExecutable = (environment) => windowsSystemExecutable('rundll32.exe', environment)

const launchThroughShellExecute = async (
  executable,
  arguments_,
  { execProcess, environment },
) => {
  await execProcess(
    shellExecuteExecutable(environment),
    ['shell32.dll,ShellExec_RunDLL', executable, ...arguments_],
    { windowsHide: true, timeout: 30_000 },
  )
}

// Current Windows builds can allow PSR through ShellExecute while rejecting a
// direct CreateProcess call. Keep the direct path and fall back only on EACCES.
const isAccessDenied = (error) => error?.code === 'EACCES'

export const startPsrProcess = async ({ executable, artifactPath }, {
  spawnProcess = spawn,
  execProcess = execFileAsync,
  environment = process.env,
} = {}) => {
  const arguments_ = psrStartArguments(artifactPath)
  try {
    await spawnAndForget(executable, arguments_, spawnProcess)
  } catch (error) {
    if (!isAccessDenied(error)) throw error
    await launchThroughShellExecute(executable, arguments_, { execProcess, environment })
  }
}

export const stopPsrProcess = async ({ executable }, {
  execProcess = execFileAsync,
  environment = process.env,
} = {}) => {
  try {
    await execProcess(executable, ['/stop'], { windowsHide: true, timeout: 30_000 })
  } catch (error) {
    if (!isAccessDenied(error)) throw error
    await launchThroughShellExecute(executable, ['/stop'], { execProcess, environment })
  }
}

const safeSessionName = (sessionId) => {
  const normalized = String(sessionId ?? 'desktop')
  .trim()
  .replace(/[^A-Za-z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80)
  return normalized || 'desktop'
}

const assertInside = (directory, candidate) => {
  const root = resolve(directory)
  const target = resolve(candidate)
  const rel = relative(root, target)
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return target
  throw new Error('Recording artifact path escaped the configured recordings directory')
}

/**
 * Create the run-scoped EffectAdapters. UFO remains a pure upstream package;
 * this adapter supplies the Windows recording boundary around its documented
 * demonstration format.
 */
export function createWindowsStepRecorder({
  recordingsDirectory,
  ufoDirectory,
  executable = join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'psr.exe'),
  platform = process.platform,
  startProcess = startPsrProcess,
  stopProcess = stopPsrProcess,
  observeArchive = readPsrArchive,
  liveEventSource = null,
  awaitArtifact = waitForArtifact,
  clock = () => new Date().toISOString(),
} = {}) {
  if (!recordingsDirectory) throw new Error('recordingsDirectory is required')
  if (!ufoDirectory) throw new Error('ufoDirectory is required')

  const active = new Map()
  const root = resolve(recordingsDirectory)

  const ensureAvailable = async () => {
    if (platform !== 'win32') throw new Error('Whole-desktop recording is available only on Windows')
    await access(executable, fsConstants.X_OK)
    await access(join(ufoDirectory, 'record_processor', 'parser', 'psr_record_parser.py'), fsConstants.R_OK)
    await mkdir(root, { recursive: true })
  }

  const captureControl = {
    id: 'ufo/psr-capture-control',
    execute: async (request) => {
      if (request?.op === 'start') {
        await ensureAvailable()
        if (active.size > 0) throw new Error('Windows Steps Recorder already has an active recording')
        const startedAt = clock()
        const stamp = startedAt.replace(/[:.]/g, '-')
        const artifactPath = join(root, `${safeSessionName(request.sessionId)}-${stamp}.zip`)
        await liveEventSource?.start(request.sessionId)
        try {
          await startProcess({ executable, artifactPath })
        } catch (error) {
          await liveEventSource?.stop()
          throw error
        }
        const handle = `psr:${request.sessionId}`
        active.set(request.sessionId, { artifactPath, handle, startedAt })
        return { handle, artifactPath, startedAt }
      }

      if (request?.op === 'stop') {
        const recording = active.get(request.sessionId)
        if (!recording) throw new Error(`No active Steps Recorder session: ${request.sessionId}`)
        try {
          await stopProcess({ executable, artifactPath: recording.artifactPath })
          await awaitArtifact(recording.artifactPath)
        } finally {
          await liveEventSource?.stop()
          active.delete(request.sessionId)
        }
        return { stopped: true, artifactPath: recording.artifactPath }
      }

      throw new Error(`Unknown capture operation: ${request?.op}`)
    },
  }

  const captureObservation = {
    id: 'ufo/psr-capture-observation',
    execute: async (request) => {
      if (request?.op !== 'observe') throw new Error(`Unknown observation operation: ${request?.op}`)
      const artifactPath = assertInside(root, request.artifactPath)
      const parsed = await observeArchive(artifactPath)
      return {
        events: parsed.events,
        applications: parsed.applications,
        session: parsed.session,
        completedAt: clock(),
      }
    },
  }

  const captureEvents = {
    id: 'ufo/desktop-capture-events',
    execute: async (request) => {
      if (request?.op !== 'poll') throw new Error(`Unknown live event operation: ${request?.op}`)
      if (!liveEventSource) return { events: [] }
      return liveEventSource.poll(request.sessionId)
    },
  }

  const stopActive = async () => {
    for (const [sessionId, recording] of active) {
      try {
        await stopProcess({ executable, artifactPath: recording.artifactPath })
        await awaitArtifact(recording.artifactPath)
      } finally {
        await liveEventSource?.stop()
        active.delete(sessionId)
      }
    }
  }

  return { captureControl, captureObservation, captureEvents, stopActive }
}
