import { spawn, execFile } from 'node:child_process'
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

const execFileAsync = promisify(execFile)

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
      action: textOf(match[2], 'Action'),
      description: textOf(match[2], 'Description'),
      screenshotFile: textOf(match[2], 'ScreenshotFileName'),
    })
  }

  const applications = [...new Set(events.map((event) => event.application).filter(Boolean))]
  return {
    events,
    applications,
    session: {
      startedAt: session.StartTime ?? null,
      stoppedAt: session.StopTime ?? null,
      declaredActionCount: Number.parseInt(session.ActionCount ?? `${events.length}`, 10),
      missedActionCount: Number.parseInt(session.MissedActionCount ?? '0', 10),
    },
  }
}

const findFirstMht = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const candidate = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = await findFirstMht(candidate)
      if (nested) return nested
    } else if (extname(entry.name).toLowerCase() === '.mht') {
      return candidate
    }
  }
  return null
}

export const windowsSystemExecutable = (name, environment = process.env) => join(
  environment.WINDIR ?? 'C:\\Windows',
  'System32',
  name,
)

/** Read a PSR ZIP using the same MHT shape consumed by UFO's record_processor. */
export async function readPsrArchive(
  artifactPath,
  { tarExecutable = windowsSystemExecutable('tar.exe') } = {},
) {
  const extractionDirectory = await mkdtemp(join(tmpdir(), 'gvsdk-ufo-recording-'))
  try {
    await execFileAsync(tarExecutable, ['-xf', artifactPath, '-C', extractionDirectory], {
      windowsHide: true,
      timeout: 30_000,
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
        await startProcess({ executable, artifactPath })
        const handle = `psr:${request.sessionId}`
        active.set(request.sessionId, { artifactPath, handle, startedAt })
        return { handle, artifactPath, startedAt }
      }

      if (request?.op === 'stop') {
        const recording = active.get(request.sessionId)
        if (!recording) throw new Error(`No active Steps Recorder session: ${request.sessionId}`)
        await stopProcess({ executable, artifactPath: recording.artifactPath })
        await awaitArtifact(recording.artifactPath)
        active.delete(request.sessionId)
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

  const stopActive = async () => {
    for (const [sessionId, recording] of active) {
      try {
        await stopProcess({ executable, artifactPath: recording.artifactPath })
        await awaitArtifact(recording.artifactPath)
      } finally {
        active.delete(sessionId)
      }
    }
  }

  return { captureControl, captureObservation, stopActive }
}
