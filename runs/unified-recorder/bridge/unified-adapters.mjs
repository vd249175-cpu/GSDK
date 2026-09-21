/**
 * runs/unified-recorder/bridge/unified-adapters.mjs
 *
 * 统一录制双源 EffectAdapter 与后处理清洗引擎：
 * 1. 流式输出：
 *    - browser: playwright-cli recording-start/stop + snapshot 轮询；
 *    - desktop: windows-input-observer.py 实时全局低级钩子（鼠标、滚轮、键盘）。
 * 2. 原生导出：
 *    - browser: 原生 Playwright 脚本（native/browser-playwright.js）；
 *    - desktop: 原生 Windows PSR ZIP 产物（native/desktop-psr.zip）。
 * 3. 产物清洗与 Agent 纯文字版本：
 *    - 解压 MHT 抽离 Base64 截图落盘为独立文件（screenshots/*.jpeg）；
 *    - 双源事件对齐与清洗合并为权威结构化事件；
 *    - 生成专供 Agent 的纯文字 Markdown（agent-transcript.md），附截图相对路径，绝无 Base64 爆上下文。
 */

import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))

let cachedCliCommand = null

/** 解析 playwright-cli 在 Windows 下的 .cmd 包装路径 */
export async function resolveCliCommand(command = 'playwright-cli') {
  if (process.platform !== 'win32') return command
  if (cachedCliCommand) return cachedCliCommand
  try {
    const { stdout } = await execFileAsync('where.exe', [command], { timeout: 15000 })
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    cachedCliCommand = lines.find((l) => l.toLowerCase().endsWith('.cmd')) ?? lines[0] ?? command
  } catch {
    cachedCliCommand = command
  }
  return cachedCliCommand
}

export function createRunCli({ command = 'playwright-cli' } = {}) {
  let resolved = null
  return async (args) => {
    if (!resolved) resolved = await resolveCliCommand(command)
    const shell = process.platform === 'win32' && resolved.toLowerCase().endsWith('.cmd')
    return (await execFileAsync(resolved, args, { timeout: 60000, windowsHide: true, shell })).stdout
  }
}

export const DESKTOP_CONTROL_ID = 'unified/desktop-control'
export const BROWSER_CONTROL_ID = 'unified/browser-control'
export const DESKTOP_OBSERVATION_ID = 'unified/desktop-observation'
export const DESKTOP_EVENTS_ID = 'unified/desktop-events'
export const BROWSER_EVENTS_ID = 'unified/browser-events'

export const windowsSystemExecutable = (name, environment = process.env) => join(
  environment.WINDIR ?? 'C:\\Windows',
  'System32',
  name,
)

const isAccessDenied = (error) => error?.code === 'EACCES'

export const startPsrProcess = async ({ executable, artifactPath }, {
  spawnProcess = spawn,
  execProcess = execFileAsync,
  environment = process.env,
} = {}) => {
  const args = [
    '/start',
    '/output', artifactPath,
    '/sc', '1',
    '/gui', '0',
    '/arcxml', '1',
    '/maxsc', '100',
  ]
  try {
    await new Promise((resolveStart, rejectStart) => {
      const child = spawnProcess(executable, args, { stdio: 'ignore', windowsHide: true })
      child.once('error', rejectStart)
      child.once('spawn', () => {
        child.unref()
        resolveStart()
      })
    })
  } catch (error) {
    if (!isAccessDenied(error)) throw error
    const rundll = windowsSystemExecutable('rundll32.exe', environment)
    await execProcess(rundll, ['shell32.dll,ShellExec_RunDLL', executable, ...args], {
      windowsHide: true,
      timeout: 30000,
    })
  }
}

export const stopPsrProcess = async ({ executable }, {
  execProcess = execFileAsync,
  environment = process.env,
} = {}) => {
  try {
    await execProcess(executable, ['/stop'], { windowsHide: true, timeout: 30000 })
  } catch (error) {
    if (!isAccessDenied(error)) throw error
    const rundll = windowsSystemExecutable('rundll32.exe', environment)
    await execProcess(rundll, ['shell32.dll,ShellExec_RunDLL', executable, '/stop'], {
      windowsHide: true,
      timeout: 30000,
    })
  }
}

export const waitForArtifact = async (artifactPath, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const details = await stat(artifactPath)
      if (details.isFile() && details.size > 0) return
    } catch {}
    await delay(200)
  }
  throw new Error(`Windows Steps Recorder did not create artifact: ${artifactPath}`)
}

/** 实时观察源事件转换为标准化事件 */
export const liveEventFrom = (input, index) => {
  const application = typeof input.application === 'string' ? input.application : null
  const windowTitle = typeof input.windowTitle === 'string' ? input.windowTitle : null
  const time = new Date(Number(input.timestamp) || Date.now()).toLocaleTimeString()
  if (input.kind === 'mouse') {
    const button = input.button === 'right' ? 'Right' : input.button === 'middle' ? 'Middle' : 'Left'
    return {
      index,
      time,
      source: 'desktop',
      application,
      windowTitle,
      action: `Mouse ${button} Click`,
      description: `Clicked at (${input.x ?? '?'}, ${input.y ?? '?'})${windowTitle ? ` in ${windowTitle}` : ''}`,
      locator: null,
      code: null,
      text: null,
      screenshotFile: null,
    }
  }
  if (input.kind === 'scroll') {
    return {
      index,
      time,
      source: 'desktop',
      application,
      windowTitle,
      action: 'Mouse Scroll',
      description: `Scrolled ${input.axis ?? 'vertical'}${windowTitle ? ` in ${windowTitle}` : ''}`,
      locator: null,
      code: null,
      text: null,
      screenshotFile: null,
    }
  }
  return {
    index,
    time,
    source: 'desktop',
    application,
    windowTitle,
    action: 'Keyboard Input',
    description: `Keyboard activity${windowTitle ? ` in ${windowTitle}` : ''}`,
    locator: null,
    code: null,
    text: null,
    screenshotFile: null,
  }
}

/** 创建 Windows 底层输入观察源子进程 */
export function createWindowsInputEventSource({
  observerScript,
  pythonExecutable = 'python.exe',
  spawnProcess = spawn,
  readyTimeoutMs = 10000,
} = {}) {
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
    const result = await Promise.race([closed.then(() => 'closed'), delay(2000).then(() => 'timeout')])
    if (result === 'timeout') {
      stoppingChild.kill()
      await Promise.race([closed, delay(1000)])
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
        const fail = (err) => {
          clearTimeout(timeout)
          rejectReady(err)
        }
        startingChild.once('error', fail)
        startingChild.once('exit', (code) => {
          if (child === startingChild) fail(new Error(`Windows input observer exited (${code}): ${stderr.trim()}`))
        })
        lines.once('line', (line) => {
          clearTimeout(timeout)
          try {
            const message = JSON.parse(line)
            if (message.type !== 'ready') throw new Error(message.message ?? 'Observer failed to initialize')
            resolveReady()
          } catch (err) {
            rejectReady(err)
          }
        })
      })
      startingChild.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000) })
      lines.on('line', (line) => {
        try {
          const message = JSON.parse(line)
          if (message.type === 'input') queued.push(message)
        } catch {}
      })
      try {
        await ready
      } catch (err) {
        await stop()
        throw err
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

/**
 * 解析 MHT 内容：
 * 1. 抽取 MIME multipart 中所有 Base64 截图并直接写入 screenshotsDir
 * 2. 解析 <UserActionData> XML 动作
 */
export async function parsePsrMhtAndExtractScreenshots(content, screenshotsDir) {
  if (typeof content !== 'string' || !content.includes('<UserActionData>')) {
    throw new Error('The recording does not contain Windows Steps Recorder UserActionData')
  }

  await mkdir(screenshotsDir, { recursive: true })

  // 1. 抽取 MIME 截图
  const boundaryMatch = content.match(/boundary=(?:"([^"\r\n]+)"|([^;\r\n\s]+))/i)
  const boundary = boundaryMatch ? (boundaryMatch[1] ?? boundaryMatch[2])?.trim() : null
  const extractedScreenshots = new Map()

  if (boundary) {
    const parts = content.split(`--${boundary}`)
    for (const part of parts) {
      const locationMatch = part.match(/Content-Location:\s*([^\r\n]+)/i)
      const encodingMatch = part.match(/Content-Transfer-Encoding:\s*base64/i)
      if (locationMatch && encodingMatch) {
        const location = locationMatch[1].trim()
        const filename = basename(location)
        // 查找空行后的正文
        const headerEnd = part.search(/\r?\n\r?\n/)
        if (headerEnd !== -1) {
          const base64Data = part.slice(headerEnd).replace(/\r?\n/g, '').replace(/--+$/, '').trim()
          if (base64Data.length > 0) {
            const buffer = Buffer.from(base64Data, 'base64')
            const targetPath = join(screenshotsDir, filename)
            await writeFile(targetPath, buffer)
            const relativePath = relative(dirname(screenshotsDir), targetPath).replace(/\\/g, '/')
            extractedScreenshots.set(filename, relativePath)
            extractedScreenshots.set(filename.toLowerCase(), relativePath)
          }
        }
      }
    }
  }

  // 2. 解析 XML
  const sessionMatch = content.match(/<RecordSession\b([^>]*)>/i)
  const session = sessionMatch ? attributesOf(sessionMatch[1]) : {}
  const events = []

  for (const match of content.matchAll(/<EachAction\b([^>]*)>([\s\S]*?)<\/EachAction>/gi)) {
    const attributes = attributesOf(match[1])
    const index = Number.parseInt(attributes.ActionNumber ?? `${events.length + 1}`, 10)
    const rawScreenshotFile = textOf(match[2], 'ScreenshotFileName')
    const screenshotRelative = rawScreenshotFile
      ? (extractedScreenshots.get(rawScreenshotFile) ?? extractedScreenshots.get(rawScreenshotFile.toLowerCase()) ?? `screenshots/${rawScreenshotFile}`)
      : null
    events.push({
      index: Number.isFinite(index) ? index : events.length + 1,
      time: attributes.Time ?? null,
      source: 'desktop',
      application: attributes.FileName ?? null,
      applicationDescription: attributes.FileDescription ?? null,
      action: textOf(match[2], 'Action') ?? 'Desktop Action',
      description: textOf(match[2], 'Description') ?? 'Recorded desktop action',
      locator: null,
      code: null,
      text: null,
      screenshotFile: screenshotRelative,
    })
  }

  const applications = [...new Set(events.map((e) => e.application).filter(Boolean))]
  return {
    events,
    applications,
    session: {
      startedAt: session.StartTime ?? null,
      stoppedAt: session.StopTime ?? null,
      declaredActionCount: Number.parseInt(session.ActionCount ?? `${events.length}`, 10),
      missedActionCount: Number.parseInt(session.MissedActionCount ?? '0', 10),
    },
    screenshots: Array.from(extractedScreenshots.keys()),
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

export async function readPsrArchiveAndExtract(
  artifactZipPath,
  screenshotsDir,
  { tarExecutable = windowsSystemExecutable('tar.exe') } = {},
) {
  const extractionDirectory = await mkdtemp(join(tmpdir(), 'gvsdk-unified-recording-'))
  try {
    await execFileAsync(tarExecutable, ['-xf', artifactZipPath, '-C', extractionDirectory], {
      windowsHide: true,
      timeout: 30000,
    })
    const mhtPath = await findFirstMht(extractionDirectory)
    if (!mhtPath) throw new Error(`No .mht recording found in ${basename(artifactZipPath)}`)
    const mhtContent = await readFile(mhtPath, 'utf8')
    return await parsePsrMhtAndExtractScreenshots(mhtContent, screenshotsDir)
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

/** 个人系统明文提取 */
export const plaintextOf = (code) => {
  if (typeof code !== 'string') return null
  const match = code.match(/(?:fill|type)\(\s*(['"])((?:\\\1|(?!\1).)*)\1/si)
  return match ? match[2] : null
}

export const browserActionOf = (code, kind) => {
  if (!code) return kind && kind !== 'action' ? kind : 'snapshot'
  if (/fill|type\(/i.test(code)) return 'fill'
  if (/goto|navigate/i.test(code)) return 'goto'
  if (/click/i.test(code)) return 'click'
  if (/press/i.test(code)) return 'press'
  if (/selectOption/i.test(code)) return 'select'
  if (/check|uncheck/i.test(code)) return 'check'
  return kind && kind !== 'action' ? kind : 'browser-action'
}

/** 解析 Playwright 脚本行 */
export function parsePlaywrightScript(script) {
  if (!script || typeof script !== 'string') return []
  let contentToParse = script
  const codeBlockMatch = script.match(/```(?:js|javascript)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    contentToParse = codeBlockMatch[1]
  }
  const lines = contentToParse
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('`') && !l.startsWith('-'))
  return lines.map((line, position) => {
    const action = browserActionOf(line, 'action')
    const text = plaintextOf(line)
    const urlMatch = line.match(/(https?:\/\/[^'"\s)]+)/)
    const targetUrl = urlMatch ? urlMatch[1] : null
    let host = null
    if (targetUrl) {
      try { host = new URL(targetUrl).host } catch {}
    }
    return {
      index: position + 1,
      source: 'browser',
      time: null,
      application: host ?? 'Browser',
      windowTitle: targetUrl,
      action,
      description: `Browser ${action}${targetUrl ? ` ${targetUrl}` : ''}`,
      locator: line,
      code: line,
      text,
      screenshotFile: null,
    }
  })
}

/** 生成 Agent 专供纯文字版本（无 Base64，附截图相对路径） */
export function buildAgentTranscript({ sessionId, startedAt, completedAt, applications, events }) {
  const header = [
    `# Unified Recording Transcript: ${sessionId ?? 'session'}`,
    `- Started: ${startedAt ?? '-'}`,
    `- Completed: ${completedAt ?? '-'}`,
    `- Applications: ${(applications ?? []).join(', ') || '-'}`,
    `- Total Steps: ${events.length}`,
    '',
    '## Step-by-Step Operations',
    '',
  ].join('\n')

  const steps = events.map((event, idx) => {
    const num = String(idx + 1).padStart(2, '0')
    const sourceTag = event.source === 'browser' ? 'Browser' : 'Desktop'
    const appTag = event.application ? ` | ${event.application}` : ''
    const lines = [
      `### Step ${num} [${sourceTag}${appTag}]`,
      `- Time: ${event.time ?? '-'}`,
      `- Action: ${event.action ?? '-'}`,
      `- Description: ${event.description ?? '-'}`,
    ]
    if (event.windowTitle) lines.push(`- Window/URL: ${event.windowTitle}`)
    if (event.code) lines.push(`- Code: \`${event.code}\``)
    if (event.text !== null && event.text !== undefined) lines.push(`- Input Text: "${event.text}"`)
    if (event.screenshotFile) lines.push(`- Screenshot: ${event.screenshotFile}`)
    return lines.join('\n')
  }).join('\n\n')

  return `${header}${steps}\n`
}

/** 生成可回放脚本 */
export function buildReplayScript(events) {
  return events.map((event) => {
    if (event.source === 'browser' && event.code) return event.code
    return `// DESKTOP ${event.index}: [${event.application ?? '-'}] ${event.action} — ${event.description}`
  }).join('\n')
}

/** 数据清洗与合并 */
export function mergeAndCleanEvents({ desktopEvents = [], browserEvents = [] }) {
  // 若同时包含桌面和浏览器动作：
  // 浏览器中有精准 code (如 click/fill/goto)；桌面 PSR 中有全局截图与前台窗口信息。
  // 若桌面动作属于 CHROME/EDGE 且时间相近，将截图赋给浏览器精准动作；
  // 外部桌面动作 (如 NOTEPAD) 原样作为 desktop step 保留。
  const result = []
  let browserIdx = 0
  const totalBrowser = browserEvents.length

  for (const desk of desktopEvents) {
    const isBrowserApp = desk.application && /chrome|msedge|firefox|browser/i.test(desk.application)
    if (isBrowserApp && browserIdx < totalBrowser) {
      const bEvent = browserEvents[browserIdx++]
      result.push({
        ...bEvent,
        screenshotFile: desk.screenshotFile ?? bEvent.screenshotFile,
        time: desk.time ?? bEvent.time,
        application: desk.application ?? bEvent.application,
      })
    } else {
      result.push(desk)
    }
  }

  // 追加剩余的浏览器事件
  while (browserIdx < totalBrowser) {
    result.push(browserEvents[browserIdx++])
  }

  // 连续同应用键盘活动去重归一化
  const cleaned = []
  for (const event of result) {
    const prev = cleaned.at(-1)
    if (
      event.action === 'Keyboard Input' &&
      prev?.action === 'Keyboard Input' &&
      prev.application === event.application
    ) {
      continue
    }
    cleaned.push(event)
  }

  return cleaned.map((e, idx) => ({ ...e, index: idx + 1 }))
}

/** 产物处理引擎：保存原生产物、提取截图、清洗合并、生成 agent-transcript.md */
export async function processRecordingExport({
  sessionId,
  sessionDirectory,
  browserRawActions = '',
  desktopZipPath = null,
  liveDesktopEvents = [],
  startedAt = null,
  completedAt = null,
  readArchive = readPsrArchiveAndExtract,
}) {
  const nativeDir = join(sessionDirectory, 'native')
  const screenshotsDir = join(sessionDirectory, 'screenshots')
  await mkdir(nativeDir, { recursive: true })
  await mkdir(screenshotsDir, { recursive: true })

  // 1. 保存浏览器原生产物
  const nativeBrowserPath = join(nativeDir, 'browser-playwright.js')
  await writeFile(nativeBrowserPath, browserRawActions || '// No browser actions recorded\n', 'utf8')

  // 2. 保存桌面原生产物并解析截图
  let nativeDesktopPath = null
  let extractedDesktop = null

  if (desktopZipPath) {
    nativeDesktopPath = join(nativeDir, 'desktop-psr.zip')
    try {
      await copyFile(desktopZipPath, nativeDesktopPath)
      extractedDesktop = await readArchive(nativeDesktopPath, screenshotsDir)
    } catch (err) {
      console.warn('[Unified Recorder] Failed to parse PSR archive, falling back to live events:', err)
    }
  }

  const desktopEvents = extractedDesktop?.events?.length > 0
    ? extractedDesktop.events
    : liveDesktopEvents
  const browserEvents = parsePlaywrightScript(browserRawActions)

  // 3. 数据清洗与对齐合并
  const mergedEvents = mergeAndCleanEvents({ desktopEvents, browserEvents })
  const applications = [...new Set([
    ...(extractedDesktop?.applications ?? []),
    ...mergedEvents.map((e) => e.application).filter(Boolean),
  ])]

  // 4. 生成 Agent 纯文字版本
  const agentTranscriptContent = buildAgentTranscript({
    sessionId,
    startedAt,
    completedAt: completedAt ?? new Date().toISOString(),
    applications,
    events: mergedEvents,
  })
  const agentTranscriptPath = join(sessionDirectory, 'agent-transcript.md')
  await writeFile(agentTranscriptPath, agentTranscriptContent, 'utf8')

  // 5. 生成 JSON 与可回放脚本
  const unifiedEventsJsonPath = join(sessionDirectory, 'unified-events.json')
  await writeFile(unifiedEventsJsonPath, JSON.stringify({
    sessionId,
    startedAt,
    completedAt: completedAt ?? new Date().toISOString(),
    applications,
    events: mergedEvents,
    nativeExports: {
      browser: relative(sessionDirectory, nativeBrowserPath).replace(/\\/g, '/'),
      desktop: nativeDesktopPath ? relative(sessionDirectory, nativeDesktopPath).replace(/\\/g, '/') : null,
    },
    agentTranscript: relative(sessionDirectory, agentTranscriptPath).replace(/\\/g, '/'),
    screenshotsDirectory: 'screenshots',
  }, null, 2), 'utf8')

  const replayPath = join(sessionDirectory, 'replay.js')
  await writeFile(replayPath, buildReplayScript(mergedEvents), 'utf8')

  return {
    events: mergedEvents,
    applications,
    sessionDirectory,
    agentTranscriptPath,
    agentTranscriptContent,
    nativeExports: {
      browser: nativeBrowserPath,
      desktop: nativeDesktopPath,
    },
    screenshotsDirectory: screenshotsDir,
    completedAt: completedAt ?? new Date().toISOString(),
  }
}

/** 创建 Unified Recorder 适配器集合 */
export function createUnifiedAdapters({
  runCli,
  cliSession = 'rec',
  cdpUrl = 'http://127.0.0.1:9343',
  pythonExecutable = 'python.exe',
  recordingsDirectory = resolve('.generated/data/recordings'),
  observerScript = join(dirname(fileURLToPath(import.meta.url)), 'windows-input-observer.py'),
  psrExecutable = join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'psr.exe'),
  enablePsr = process.platform === 'win32',
} = {}) {
  if (typeof runCli !== 'function') throw new Error('createUnifiedAdapters 需要 runCli(args) 函数')

  const activeDesktop = new Map()
  let inputSource = null

  const desktopControl = {
    id: DESKTOP_CONTROL_ID,
    execute: async (request) => {
      if (request?.op === 'start') {
        if (activeDesktop.has(request.sessionId)) throw new Error('Desktop recording already active')
        const startedAt = new Date().toISOString()
        const stamp = startedAt.replace(/[:.]/g, '-')
        const sessionDir = join(recordingsDirectory, `${request.sessionId}-${stamp}`)
        await mkdir(sessionDir, { recursive: true })
        const artifactPath = join(sessionDir, 'raw-desktop-psr.zip')

        let psrStarted = false
        if (enablePsr && process.platform === 'win32') {
          try {
            await access(psrExecutable, fsConstants.X_OK)
            await startPsrProcess({ executable: psrExecutable, artifactPath })
            psrStarted = true
          } catch (err) {
            console.warn('[Unified Recorder] PSR start skipped / unavailable:', err.message)
          }
        }

        if (!inputSource && process.platform === 'win32') {
          try {
            inputSource = createWindowsInputEventSource({
              observerScript,
              pythonExecutable,
            })
            await inputSource.start()
          } catch (err) {
            console.warn('[Unified Recorder] Windows input observer start skipped:', err.message)
            inputSource = null
          }
        }

        activeDesktop.set(request.sessionId, {
          startedAt,
          artifactPath: psrStarted ? artifactPath : null,
          sessionDir,
          liveEvents: [],
        })

        return {
          handle: `unified-desktop:${request.sessionId}`,
          startedAt,
          ...(psrStarted ? { artifactPath } : {}),
          sessionDir,
        }
      }

      if (request?.op === 'stop') {
        const recording = activeDesktop.get(request.sessionId)
        if (!recording) throw new Error(`No active unified desktop session: ${request.sessionId}`)

        if (recording.artifactPath) {
          try {
            await stopPsrProcess({ executable: psrExecutable })
            await waitForArtifact(recording.artifactPath, 15000)
          } catch (err) {
            console.warn('[Unified Recorder] PSR stop/wait artifact warning:', err.message)
          }
        }

        let finalLiveEvents = []
        if (inputSource) {
          try {
            const polled = await inputSource.poll()
            finalLiveEvents = polled.events
            await inputSource.stop()
          } finally {
            inputSource = null
          }
        }

        recording.liveEvents = [...recording.liveEvents, ...finalLiveEvents]
        const allLiveEvents = [...recording.liveEvents]
        activeDesktop.delete(request.sessionId)

        return {
          stopped: true,
          liveEvents: allLiveEvents,
          sessionDir: recording.sessionDir,
          ...(recording.artifactPath ? { artifactPath: recording.artifactPath } : {}),
        }
      }

      throw new Error(`Unknown unified desktop-control request: ${JSON.stringify(request?.op)}`)
    },
  }

  const desktopEvents = {
    id: DESKTOP_EVENTS_ID,
    execute: async (request) => {
      if (request?.op !== 'poll') throw new Error(`Unknown unified desktop-events request: ${JSON.stringify(request?.op)}`)
      if (!inputSource) return { events: [] }
      const polled = await inputSource.poll()
      const recording = activeDesktop.get(request?.sessionId)
      if (recording) {
        recording.liveEvents.push(...polled.events)
      }
      return polled
    },
  }

  const desktopObservation = {
    id: DESKTOP_OBSERVATION_ID,
    execute: async (request) => {
      if (request?.op !== 'observe') throw new Error(`Unknown unified desktop-observation request: ${JSON.stringify(request?.op)}`)
      const sessionDirectory = request.sessionDir ?? dirname(request.artifactPath ?? recordingsDirectory)
      const processed = await processRecordingExport({
        sessionId: request.sessionId,
        sessionDirectory,
        browserRawActions: request.browserActions ?? '',
        desktopZipPath: request.artifactPath,
        liveDesktopEvents: request.liveEvents ?? [],
        startedAt: request.startedAt,
        completedAt: request.completedAt,
      })
      return processed
    },
  }

  const browserControl = {
    id: BROWSER_CONTROL_ID,
    cliSession,
    cdpUrl,
    execute: async (request) => {
      if (request?.op === 'start') {
        try {
          await runCli(['attach', `--cdp=${cdpUrl}`, `--session=${cliSession}`])
        } catch (attachErr) {
          try {
            const browserScript = join(repositoryRoot, '.agents', 'skills', 'browser-setup', 'scripts', 'browser.ps1')
            await execFileAsync('powershell.exe', [
              '-NoProfile',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              browserScript,
              '-Action',
              'Start',
            ], { timeout: 30000 })
            await runCli(['attach', `--cdp=${cdpUrl}`, `--session=${cliSession}`])
          } catch {
            throw new Error(`浏览器会话连接失败 (${cdpUrl})。请先点击顶部“打开专用浏览器”确保 9343 已就绪: ${attachErr.message}`)
          }
        }
        await runCli([`-s=${cliSession}`, 'recording-start'])
        return { handle: `playwright-cli:${cliSession}:${request.sessionId}` }
      }
      if (request?.op === 'stop') {
        try {
          const output = await runCli([`-s=${cliSession}`, 'recording-stop'])
          await runCli([`-s=${cliSession}`, 'detach']).catch(() => {})
          const actions = String(output ?? '')
          return { stopped: true, actions }
        } catch (err) {
          await runCli([`-s=${cliSession}`, 'detach']).catch(() => {})
          return { stopped: true, actions: '', error: err?.message ?? String(err) }
        }
      }
      throw new Error(`Unknown unified browser-control request: ${JSON.stringify(request?.op)}`)
    },
  }

  const browserEvents = {
    id: BROWSER_EVENTS_ID,
    cliSession,
    cdpUrl,
    execute: async (request) => {
      if (request?.op !== 'poll') throw new Error(`Unknown unified browser-events request: ${JSON.stringify(request?.op)}`)
      const output = await runCli([`-s=${cliSession}`, 'snapshot'])
      return {
        events: [{ kind: 'snapshot', sessionId: request?.sessionId ?? null, snapshot: String(output ?? '') }],
        cursor: request?.cursor ?? null,
      }
    },
  }

  return { desktopControl, desktopObservation, desktopEvents, browserControl, browserEvents }
}
