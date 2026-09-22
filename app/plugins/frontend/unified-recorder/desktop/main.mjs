import { app, BrowserWindow, Menu, clipboard, ipcMain, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { defaultValueCodec } from '@graphframework/sdk/protocol'
import { serveRunControl, callRunControl } from '../../../../../packages/tooling/run/index.mjs'

const execFileAsync = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

const context = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const runtime = context.runtimeDirectory
const token = readFileSync(join(runtime, 'control-token'), 'utf8').trim()

process.on('uncaughtException', (error) => console.error('[Unified Recorder Host]', error?.stack ?? error))
process.on('unhandledRejection', (error) => console.error('[Unified Recorder Host]', error?.stack ?? error))

let mainWindow = null
let stopped = false

async function getSessionSnapshot() {
  try {
    const graphPrefix = `${context.instance.graph ?? 'recorder'}/`
    // 前端无状态：只读 projection。live 事件 tick 由后端宿主常驻时钟注入，
    // 此处不再发送 PollUnifiedEventsInfo（见 runs/main/host.mjs startPolling）。
    const projection = await callRunControl(runtime, 'projection')
    const nodeEntry = projection.nodes?.[`${graphPrefix}session`] ?? projection.nodes?.['example.unified-recorder/session']
    const state = defaultValueCodec.decode(nodeEntry?.state) ?? {}
    let browserAlive = false
    try {
      const bRes = await fetch('http://127.0.0.1:9343/json/version', { signal: AbortSignal.timeout(800) })
      browserAlive = bRes.ok
    } catch {}

    return {
      status: state.status ?? 'idle',
      sessionId: state.sessionId ?? null,
      sources: Array.isArray(state.sources) ? state.sources : ['desktop', 'browser'],
      handles: state.handles ?? { desktop: null, browser: null },
      eventCount: state.eventCount ?? 0,
      events: Array.isArray(state.events) ? state.events : [],
      applications: Array.isArray(state.applications) ? state.applications : [],
      artifactPath: state.artifactPath ?? null,
      sessionDir: state.sessionDir ?? null,
      agentTranscriptPath: state.agentTranscriptPath ?? null,
      agentTranscriptContent: state.agentTranscriptContent ?? null,
      screenshotsDirectory: state.screenshotsDirectory ?? null,
      nativeExports: state.nativeExports ?? { browser: null, desktop: null },
      browserActions: state.browserActions ?? null,
      startedAt: state.startedAt ?? null,
      completedAt: state.completedAt ?? null,
      lastError: state.lastError ?? null,
      progressLog: Array.isArray(state.progressLog) ? state.progressLog : [],
      browserAlive,
      revision: projection.revision ?? 0,
    }
  } catch (error) {
    return {
      status: 'error',
      sessionId: null,
      sources: ['desktop', 'browser'],
      handles: { desktop: null, browser: null },
      eventCount: 0,
      events: [],
      applications: [],
      artifactPath: null,
      sessionDir: null,
      agentTranscriptPath: null,
      agentTranscriptContent: null,
      screenshotsDirectory: null,
      nativeExports: { browser: null, desktop: null },
      browserActions: null,
      startedAt: null,
      completedAt: null,
      lastError: error?.message ?? 'Failed to read recorder state',
      revision: 0,
    }
  }
}

async function startHost() {
  const server = await serveRunControl({
    token,
    runId: context.runId,
    handlers: {
      health: () => ({ runId: context.runId, pid: process.pid, instanceId: context.instance.id }),
      ready: async () => ({ ready: true }),
      gate: async () => ({ gated: true }),
      'stop-sources': async () => ({ stopped: true }),
      close: async () => {
        stopped = true
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy()
        setImmediate(async () => {
          await server.close()
          app.quit()
        })
        return { closed: true }
      },
    },
  })

  writeFileSync(
    join(runtime, `frontend-${context.instance.id}.json`),
    JSON.stringify({ runId: context.runId, address: server.address, pid: process.pid }),
  )

  ipcMain.handle('recorder:read-state', async () => getSessionSnapshot())
  ipcMain.handle('recorder:start', async (_event, sessionId, sources) => {
    const graphName = context.instance.graph ?? 'recorder'
    const normalized = typeof sessionId === 'string' && sessionId.trim()
      ? sessionId.trim()
      : `unified-${Date.now()}`
    await callRunControl(runtime, 'inject-renderer', {
      targetNodeId: `${graphName}/session`,
      info: {
        type: 'StartRecordingInfo',
        sessionId: normalized,
        ...(Array.isArray(sources) && sources.length > 0 ? { sources } : {}),
      },
    })
    return getSessionSnapshot()
  })
  ipcMain.handle('recorder:stop', async () => {
    const graphName = context.instance.graph ?? 'recorder'
    await callRunControl(runtime, 'inject-renderer', {
      targetNodeId: `${graphName}/session`,
      info: { type: 'StopRecordingInfo' },
    })
    return getSessionSnapshot()
  })
  ipcMain.handle('recorder:open-artifact', async () => {
    const state = await getSessionSnapshot()
    if (!state.artifactPath) return { ok: false, error: 'No recording artifact is available' }
    shell.showItemInFolder(state.artifactPath)
    return { ok: true }
  })
  ipcMain.handle('recorder:open-path', async (_event, targetPath) => {
    if (typeof targetPath !== 'string' || !targetPath) return { ok: false, error: 'Invalid path' }
    shell.showItemInFolder(targetPath)
    return { ok: true }
  })
  ipcMain.handle('recorder:launch-browser', async () => {
    try {
      const isAlive = async () => {
        try {
          const res = await fetch('http://127.0.0.1:9343/json/version', { signal: AbortSignal.timeout(1200) })
          return res.ok
        } catch {
          return false
        }
      }

      let alive = await isAlive()
      if (!alive) {
        const scriptPath = resolve(repositoryRoot, '.agents', 'skills', 'browser-setup', 'scripts', 'browser.ps1')
        await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-Action',
          'Start',
        ], { timeout: 30000 })

        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 400))
          if (await isAlive()) {
            alive = true
            break
          }
        }
      }

      if (alive) {
        try {
          const listRes = await fetch('http://127.0.0.1:9343/json/list', { signal: AbortSignal.timeout(1500) })
          const pages = await listRes.json()
          const pageTargets = Array.isArray(pages) ? pages.filter((p) => p.type === 'page') : []
          if (pageTargets.length === 0) {
            await fetch('http://127.0.0.1:9343/json/new?about:blank', { method: 'PUT', signal: AbortSignal.timeout(1500) })
          } else {
            await fetch(`http://127.0.0.1:9343/json/activate/${pageTargets[0].id}`, { signal: AbortSignal.timeout(1500) })
          }
        } catch {}
        return { ok: true, alive: true }
      }

      return { ok: false, error: '专用浏览器已执行拉起，但 9343 端口未就绪。' }
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })
  ipcMain.handle('recorder:copy-to-clipboard', async (_event, text) => {
    if (typeof text !== 'string') return { ok: false }
    clipboard.writeText(text)
    return { ok: true }
  })
  ipcMain.handle('recorder:read-image', async (_event, targetPath) => {
    try {
      if (typeof targetPath !== 'string' || !targetPath) return { ok: false, error: 'Invalid path' }
      const resolved = resolve(targetPath)
      const ext = extname(resolved).toLowerCase()
      if (!['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'].includes(ext)) {
        return { ok: false, error: 'Unsupported image extension' }
      }
      const data = await readFile(resolved)
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      return { ok: true, dataUrl: `data:${mime};base64,${data.toString('base64')}` }
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.on('shell:minimize', () => mainWindow?.minimize())
  ipcMain.on('shell:toggle-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('shell:close', () => {
    callRunControl(runtime, 'request-stop').catch(() => {})
  })

  Menu.setApplicationMenu(null)
  const isMac = process.platform === 'darwin'
  await app.whenReady()

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 11 } : undefined,
    autoHideMenuBar: true,
    backgroundColor: '#0c0e12',
    title: 'GraphFramework · 统一录制',
    webPreferences: {
      preload: join(context.pluginDirectory, 'desktop', 'preload.cjs'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.setMenu(null)
  mainWindow.loadFile(context.rendererFile)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.setAlwaysOnTop(true)
    setTimeout(() => mainWindow?.setAlwaysOnTop(false), 3000)
  })
  mainWindow.on('close', () => {
    if (!stopped) callRunControl(runtime, 'request-stop').catch((error) => console.error(error))
  })
}

startHost().catch((error) => {
  console.error('Failed to start unified recorder frontend host:', error)
  app.exit(1)
})
