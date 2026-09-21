import { app, BrowserWindow, Menu, clipboard, ipcMain, shell } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultValueCodec } from '@graphframework/sdk/protocol'
import { serveRunControl, callRunControl } from '../../../../../../packages/tooling/run/src/control.mjs'

const context = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const runtime = context.runtimeDirectory
const token = readFileSync(join(runtime, 'control-token'), 'utf8').trim()

process.on('uncaughtException', (error) => console.error('[OS Recorder Host]', error?.stack ?? error))
process.on('unhandledRejection', (error) => console.error('[OS Recorder Host]', error?.stack ?? error))

let mainWindow = null
let stopped = false
let isPolling = false

async function getSessionSnapshot() {
  try {
    const graphPrefix = `${context.instance.graph ?? 'recorder'}/`
    let projection = await callRunControl(runtime, 'projection')
    let nodeEntry = projection.nodes?.[`${graphPrefix}session`] ?? projection.nodes?.['example.os-recorder/session']
    let state = defaultValueCodec.decode(nodeEntry?.state) ?? {}
    if (state.status === 'recording' && !isPolling) {
      isPolling = true
      try {
        await callRunControl(runtime, 'inject-host', {
          frontendId: context.instance.id ?? 'recorder-ui',
          targetNodeId: `${graphPrefix}observation`,
          info: { type: 'PollRecordingEventsInfo', sessionId: state.sessionId },
        })
        projection = await callRunControl(runtime, 'projection')
        nodeEntry = projection.nodes?.[`${graphPrefix}session`] ?? projection.nodes?.['example.os-recorder/session']
        state = defaultValueCodec.decode(nodeEntry?.state) ?? {}
      } catch {
        // A later refresh retries the observation poll without changing owner state.
      } finally {
        isPolling = false
      }
    }
    return {
      status: state.status ?? 'idle',
      sessionId: state.sessionId ?? null,
      handle: state.handle ?? null,
      eventCount: state.eventCount ?? 0,
      events: Array.isArray(state.events) ? state.events : [],
      applications: Array.isArray(state.applications) ? state.applications : [],
      artifactPath: state.artifactPath ?? null,
      recorder: state.recorder ?? 'Microsoft UFO / Windows Steps Recorder',
      startedAt: state.startedAt ?? null,
      completedAt: state.completedAt ?? null,
      lastError: state.lastError ?? null,
      revision: projection.revision ?? 0,
    }
  } catch (error) {
    return {
      status: 'error',
      sessionId: null,
      handle: null,
      eventCount: 0,
      events: [],
      applications: [],
      artifactPath: null,
      recorder: 'Microsoft UFO / Windows Steps Recorder',
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
  ipcMain.handle('recorder:start', async (_event, sessionId) => {
    const graphName = context.instance.graph ?? 'recorder'
    const normalized = typeof sessionId === 'string' && sessionId.trim()
      ? sessionId.trim()
      : `desktop-${Date.now()}`
    await callRunControl(runtime, 'inject-renderer', {
      targetNodeId: `${graphName}/session`,
      info: { type: 'StartRecordingInfo', sessionId: normalized },
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
  ipcMain.handle('recorder:copy-to-clipboard', async (_event, text) => {
    if (typeof text !== 'string') return { ok: false }
    clipboard.writeText(text)
    return { ok: true }
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
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 580,
    frame: false,
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 11 } : undefined,
    autoHideMenuBar: true,
    backgroundColor: '#0c0e12',
    title: 'GraphFramework · 全电脑操作录制',
    webPreferences: {
      preload: join(context.pluginDirectory, 'desktop', 'preload.cjs'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.setMenu(null)
  mainWindow.loadFile(context.rendererFile)
  mainWindow.on('close', () => {
    if (!stopped) callRunControl(runtime, 'request-stop').catch((error) => console.error(error))
  })
}

startHost().catch((error) => {
  console.error('Failed to start OS recorder frontend host:', error)
  app.exit(1)
})
