import { app, BrowserWindow, clipboard, dialog, ipcMain as electronIpcMain, protocol, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCommandGate, bindCommandIpc } from '@graphvideo/desktop/command-gate'
import { connectFrontendHost, frontendContext } from './services/frontend-daemon-host.mjs'
import { NodeGenerationAdapter } from './effects/node-generation-adapter.ts'
import { createElectronWindowAdapter } from '@graphvideo/desktop/electron-window'
import {
  openLocalProject,
  persistGraphMetadata,
  saveProjectStructure,
  promoteProjectNodeVersion,
  resolveProjectNodeVersionPath,
  importProjectNodeVersion,
} from './services/project-store.mjs'
import {
  listProjectSnapshots,
  createProjectSnapshot,
  branchProjectSnapshot,
} from './services/project-snapshot-store.mjs'
import { copyProjectVersions } from './services/project-clipboard.mjs'
import { exportProjectVideos } from './services/project-video-export.mjs'
import { createProjectAssetResponse } from './services/project-asset.mjs'
import { resolveProjectPath } from './services/project-paths.mjs'
import { getProjectHistory } from './services/project-history.mjs'
import { ProjectExternalSync } from './services/project-external-sync.mjs'
import {
  listGenerationModels,
  resolveGenerationPrompt,
  evaluateGenerationDag,
} from './services/generation-model-store.mjs'
import { ElementCatalog } from '@graphvideo/desktop/element-catalog'
import {
  discoverAgentTemplates,
  resolveAgentDirectory,
  listPromptEntries,
  readPromptFile,
  savePromptFile,
  createPromptFile,
  createPromptDirectory,
  renamePromptEntry,
  deletePromptEntry,
} from './services/agent-catalog.mjs'
import {
  listStyleProbeTargets,
  readStyleProbeTarget,
  saveStyleProbeTarget,
  createStyleProbeTarget,
  deleteStyleProbeTarget,
  importStyleProbeMedia,
} from './services/style-probe-store.mjs'

const failHost = (error) => { console.error(error?.stack ?? error); app.exit(1) }
process.on('uncaughtException', failHost)
process.on('unhandledRejection', failHost)
const here = join(frontendContext.pluginDirectory, 'desktop')
const runOverrides = {
  userDataPath: process.env.GRAPHVIDEO_RUN_USER_DATA ?? null,
  dataDirectory: process.env.GRAPHVIDEO_RUN_DATA_DIR ?? null,
  agentControlFile: process.env.GRAPHVIDEO_AGENT_CONTROL_FILE ?? null,
  telemetryPort: process.env.GRAPHVIDEO_RUN_TELEMETRY_PORT ? Number(process.env.GRAPHVIDEO_RUN_TELEMETRY_PORT) : null,
  viteDevServerUrl: process.env.GRAPHVIDEO_RUN_VITE_URL ?? process.env.VITE_DEV_SERVER_URL ?? null,
  daemonAddress: process.env.GRAPHVIDEO_RUN_DAEMON_ADDRESS ?? null,
  daemonTokenFile: process.env.GRAPHVIDEO_RUN_DAEMON_TOKEN_FILE ?? null,
};
const application = { definition: frontendContext.definition, directory: frontendContext.pluginDirectory, rendererFile: frontendContext.rendererFile,
  plugins: frontendContext.definition.plugins.map((plugin) => ({ id: plugin.id, directory: plugin.path })) }
const appRoot = frontendContext.pluginDirectory
const pluginRoot = join(here, '..')
let agentControl = null
const commandGate = createCommandGate()
let commandIpc = null
let lifecycle = null
let bootstrapPromise = Promise.resolve()
let allowQuit = false
let handlingQuit = false
let acceptingObservations = true
let stopTelemetrySubscription = () => {}
const requestQuit = () => { void host.requestStop().catch((error) => dialog.showErrorBox('GraphVideo 未完成退出', error.message)) }

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  try {
    const content = readFileSync(filePath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/)
      if (match) {
        const key = match[1]
        let value = match[2].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        if (!process.env[key]) {
          process.env[key] = value
        }
      }
    }
  } catch {}
}

loadEnvFile(join(appRoot, '.env'))
loadEnvFile(join(appRoot, '..', '.env'))

// 注册特权资源协议（必须在 app ready 之前）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'graphvideo-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

let activeProjectRoot = null
let mainWindow = null
let pendingCloseObservation = Promise.resolve()

// 广播通知到所有渲染窗口
function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  })
}

// 外部文件修改监听同步
const projectExternalSync = new ProjectExternalSync(
  (project) => broadcast('project:external-update', project),
  (markdown) => broadcast('project:external-markdown-update', markdown),
)

// 纯 Node 原生流式生成适配器（彻底移除 Python，杜绝网络锁死）
const generationAdapter = new NodeGenerationAdapter({
  getProjectRoot: () => activeProjectRoot,
  comfyApiKey: process.env.COMFY_API_KEY || process.env.COMFY_CLOUD_API_KEY || '',
})

const electronWindowAdapter = createElectronWindowAdapter({
  openWindow: (config) => createWindow(config),
  getWindow: () => mainWindow,
})

let host = null
let resolveRendererReady, rejectRendererReady
const rendererReady = new Promise((resolve, reject) => { resolveRendererReady = resolve; rejectRendererReady = reject })
void rendererReady.catch(() => undefined)
electronIpcMain.once('frontend:ready', () => resolveRendererReady({ ready: true }))
electronIpcMain.once('frontend:failed', (_event, message) => rejectRendererReady(new Error(String(message))))
async function submitDesktopInfo(info) {
  await host.injectHost('host-el', info)
}

function submitDesktopInfoFromEvent(info) {
  return submitDesktopInfo(info).catch((error) => {
    console.error('[GraphVideo] Desktop lifecycle Info failed:', error)
  })
}

function reopenDesktopFromEvent() {
  if (!commandGate.accepting || !host || lifecycle?.closing) return
  void commandGate.run(async () => {
    await pendingCloseObservation
    if (!lifecycle?.closing) await submitDesktopInfo({ type: 'DesktopStartRequestedInfo' })
  }).catch((error) => {
    console.error('[GraphVideo] Desktop reopen Info failed:', error)
  })
}

async function openProjectAtPath(projectPath) {
  loadEnvFile(join(projectPath, '.env'))
  const project = await openLocalProject(projectPath)
  activeProjectRoot = projectPath
  await projectExternalSync.start(projectPath)
  await getProjectHistory().record(projectPath)

  // 向因果图根节点 src-fs-source 注入 ProjectOpenedInfo
  try {
    await host.injectRoot('src-fs-source', {
      type: 'ProjectOpenedInfo',
      project,
    })
  } catch (err) {
    console.error('[GraphVideo] ProjectOpenedInfo injection warning:', err?.message || err)
  }

  return project
}

// 资产协议请求处理 (graphvideo-asset://)
async function handleAssetRequest(request) {
  if (!activeProjectRoot) return new Response('No active project', { status: 404 })
  try {
    const url = new URL(request.url)
    if (url.hostname === 'media') {
      const rawPath = url.pathname.replace(/^\/+/, '')
      const relativePath = decodeURIComponent(rawPath)
      const filePath = resolveProjectPath(activeProjectRoot, join('media', relativePath))
      return createProjectAssetResponse(request, filePath)
    }
    const [encodedNodeId, encodedVersionId] = url.pathname.split('/').filter(Boolean)
    if (url.hostname !== 'node' || !encodedNodeId || !encodedVersionId) {
      return new Response('Invalid asset URL', { status: 400 })
    }
    const filePath = await resolveProjectNodeVersionPath(
      activeProjectRoot,
      decodeURIComponent(encodedNodeId),
      decodeURIComponent(encodedVersionId),
    )
    return createProjectAssetResponse(request, filePath)
  } catch (error) {
    return new Response(error?.message || 'Asset not found', { status: 404 })
  }
}

// 独立观测器开发工具环回接口 (Loopback Telemetry Server for tools/causal-visualizer)
let telemetryServer = null
const sseClients = new Set()
const discoveredRoutes = new Map()
const telemetryBuffer = []

function recordAndBroadcastTelemetry(event) {
  if (event?.type === 'info_sent' && event.fromNodeId && event.toNodeId) {
    const edgeKey = `${event.fromNodeId}->${event.toNodeId}`
    discoveredRoutes.set(edgeKey, {
      from: event.fromNodeId,
      to: event.toNodeId,
      infoType: event.info?.type,
    })
  }

  telemetryBuffer.unshift(event)
  if (telemetryBuffer.length > 100) telemetryBuffer.length = 100

  broadcast('graph:event', { event: 'causal:telemetry', payload: event })

  if (sseClients.size > 0) {
    const sseMessage = `data: ${JSON.stringify(event)}\n\n`
    for (const client of sseClients) {
      try {
        client.write(sseMessage)
      } catch {
        sseClients.delete(client)
      }
    }
  }
}

function startTelemetryLoopbackServer(port = 51888) {
  if (telemetryServer) return
  telemetryServer = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)

    if (parsedUrl.pathname === '/api/topology') {
      try {
        const topo = host.readStaticTopology()
        const projection = host.readProjection()
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(
          JSON.stringify({
            revision: topo.revision,
            scheduler: projection.scheduler,
            nodes: topo.nodes,
            routes: topo.routes,
            recentEvents: telemetryBuffer.slice(0, 50),
          }),
        )
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err?.message || String(err) }))
      }
      return
    }

    if (parsedUrl.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      sseClients.add(res)
      req.on('close', () => {
        sseClients.delete(res)
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  })

  telemetryServer.on('error', (err) => {
    console.warn('[GraphVideo] Telemetry loopback server warning:', err?.message || err)
  })

  telemetryServer.listen(port, '127.0.0.1', () => {
    console.log(`[GraphVideo] Causal Telemetry loopback server active on http://127.0.0.1:${port}`)
  })
}

// 注册 IPC 通道
function registerIpcHandlers() {
  const ipcMain = commandIpc = bindCommandIpc(electronIpcMain, commandGate, {
    allowRead: (channel, args) => channel === 'graph:request' && args[0]?.method === 'graph.projection.read',
  })
  // 窗口基础控制
  ipcMain.on('window:minimize', () => submitDesktopInfoFromEvent({ type: 'WindowActionTaskInfo', action: 'MINIMIZE' }))
  ipcMain.on('window:toggle-maximize', () => submitDesktopInfoFromEvent({ type: 'WindowActionTaskInfo', action: 'TOGGLE_MAXIMIZE' }))
  ipcMain.on('window:close', requestQuit)
  ipcMain.on('window:reload', () => submitDesktopInfoFromEvent({ type: 'WindowActionTaskInfo', action: 'RELOAD' }))

  // 微内核因果通信接口
  ipcMain.handle('graph:request', async (_event, { method, input }) => {
    switch (method) {
      case 'graph.injectRootInfo': {
        return host.injectRoot(input.targetNodeId, input.info, input.submissionId)
      }
      case 'graph.projection.read':
        return { projection: host.readProjection() }
      case 'graph.topology.read': {
        const topo = host.readStaticTopology()
        const projection = host.readProjection()
        return {
          revision: topo.revision,
          scheduler: projection.scheduler,
          nodes: topo.nodes,
          routes: topo.routes,
        }
      }
      case 'graph.cancel':
        return { cancelled: false }
      default:
        throw new Error(`不支持的 graph:request 方法: ${method}`)
    }
  })

  // 项目管理接口
  ipcMain.handle('project:open-local', async (_event, targetPath) => {
    let resolvedPath = targetPath
    if (!resolvedPath) {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '打开 GraphVideo 项目',
      })
      if (result.canceled || result.filePaths.length === 0) return { canceled: true }
      resolvedPath = result.filePaths[0]
    }
    const project = await openProjectAtPath(resolvedPath)
    return { canceled: false, project }
  })

  ipcMain.handle('project:restore-last', async () => {
    try {
      const history = getProjectHistory()
      const recent = await history.list()
      if (recent[0]?.path) {
        return openProjectAtPath(recent[0].path)
      }
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('project:list-recent', async () => getProjectHistory().list())
  ipcMain.handle('project:remove-recent', async (_event, projectPath) => getProjectHistory().remove(projectPath))
  ipcMain.handle('project:snapshots-list', async () => (activeProjectRoot ? listProjectSnapshots(activeProjectRoot) : []))
  ipcMain.handle('project:snapshots-create', async (_event, label) => {
    if (!activeProjectRoot) throw new Error('未打开项目')
    return createProjectSnapshot(activeProjectRoot, label)
  })
  ipcMain.handle('project:snapshots-branch', async (_event, snapshotId, branchName) => {
    if (!activeProjectRoot) throw new Error('未打开项目')
    const branchPath = await branchProjectSnapshot(activeProjectRoot, snapshotId, branchName)
    return openProjectAtPath(branchPath)
  })
  ipcMain.handle('project:promote-node-version', async (_event, nodeId, versionId) => {
    if (!activeProjectRoot) throw new Error('未打开项目')
    return promoteProjectNodeVersion(activeProjectRoot, nodeId, versionId)
  })
  ipcMain.handle('project:copy-version-files', async (_event, items) => {
    if (!activeProjectRoot) throw new Error('未打开项目')
    return copyProjectVersions(activeProjectRoot, items)
  })
  ipcMain.handle('project:export-current-videos', async (_event, nodeIds) => {
    if (!activeProjectRoot) throw new Error('未打开项目')
    const destination = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: '导出视频至目录',
    })
    if (destination.canceled || !destination.filePaths[0]) return { canceled: true }
    const result = await exportProjectVideos(activeProjectRoot, nodeIds, destination.filePaths[0])
    return { canceled: false, ...result }
  })

  // 扩展与元素清单
  const elementCatalog = new ElementCatalog({
    pluginDirectories: Object.fromEntries(application.plugins.map((plugin) => [plugin.id, plugin.directory])),
    pluginIds: application.plugins.map((plugin) => plugin.id),
  })
  ipcMain.handle('elements:list', async () => elementCatalog.scan())
  ipcMain.handle('elements:refresh', async () => elementCatalog.scan())

  // 模型库接口
  const modelsDir = join(pluginRoot, 'resources', 'generation-models')
  ipcMain.handle('generation-models:list', async () => listGenerationModels(modelsDir))
  ipcMain.handle('generation-models:resolve', async (_event, input) => resolveGenerationPrompt(modelsDir, input))
  ipcMain.handle('generation-models:evaluate-dag', async (_event, projectRoot) => evaluateGenerationDag(modelsDir, projectRoot || activeProjectRoot))

  // 项目版本导入接口
  ipcMain.handle('project:import-node-version', async (_event, nodeId, sourcePath) => {
    if (!activeProjectRoot) throw new Error('未打开项目')
    let resolvedSource = sourcePath
    if (!resolvedSource) {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        title: '选择导入文件',
      })
      if (result.canceled || !result.filePaths[0]) return { canceled: true }
      resolvedSource = result.filePaths[0]
    }
    const version = await importProjectNodeVersion(activeProjectRoot, nodeId, resolvedSource)
    return { canceled: false, version }
  })

  // 智能体目录接口
  const templatesRoot = join(pluginRoot, 'resources', 'templates')
  ipcMain.handle('agent:discover', async () => discoverAgentTemplates(templatesRoot))
  ipcMain.handle('agent:clipboard-read-text', () => clipboard.readText())
  ipcMain.handle('agent:clipboard-write-text', (_event, value) => {
    clipboard.writeText(String(value ?? ''))
    return true
  })
  ipcMain.handle('agent:open-directory', async (_event, { templateId, agentId }) => {
    const dir = await resolveAgentDirectory(templatesRoot, templateId, agentId)
    await shell.openPath(dir)
    return { opened: true, directory: dir }
  })
  ipcMain.handle('agent:launch-native-terminal', async (_event, { templateId, agentId }) => {
    const dir = await resolveAgentDirectory(templatesRoot, templateId, agentId)
    await shell.openPath(dir)
    return { launched: true, directory: dir }
  })

  // 提示词库接口
  const promptLibraryRoot = join(pluginRoot, 'resources', 'prompt-library')
  ipcMain.handle('prompt-library:list', async () => listPromptEntries(promptLibraryRoot))
  ipcMain.handle('prompt-library:read', async (_event, relativePath) => readPromptFile(promptLibraryRoot, relativePath))
  ipcMain.handle('prompt-library:save', async (_event, relativePath, content) => savePromptFile(promptLibraryRoot, relativePath, content))
  ipcMain.handle('prompt-library:create', async (_event, relativePath, content) => createPromptFile(promptLibraryRoot, relativePath, content))
  ipcMain.handle('prompt-library:create-directory', async (_event, relativePath) => createPromptDirectory(promptLibraryRoot, relativePath))
  ipcMain.handle('prompt-library:rename', async (_event, sourcePath, targetPath) => renamePromptEntry(promptLibraryRoot, sourcePath, targetPath))
  ipcMain.handle('prompt-library:delete', async (_event, relativePath) => deletePromptEntry(promptLibraryRoot, relativePath))

  // 风格探针接口
  ipcMain.handle('style-probe:list-targets', async () => (activeProjectRoot ? listStyleProbeTargets(activeProjectRoot) : []))
  ipcMain.handle('style-probe:read-target', async (_event, fileName) => {
    if (!activeProjectRoot) throw new Error('未打开项目')
    return readStyleProbeTarget(activeProjectRoot, fileName)
  })
  ipcMain.handle('style-probe:save-target', async (_event, fileName, content) => {
    if (!activeProjectRoot) throw new Error('未打开项目')
    return saveStyleProbeTarget(activeProjectRoot, fileName, content)
  })
  ipcMain.handle('style-probe:create-target', async (_event, fileName, title) => {
    if (!activeProjectRoot) throw new Error('未打开项目')
    return createStyleProbeTarget(activeProjectRoot, fileName, title)
  })
  ipcMain.handle('style-probe:delete-target', async (_event, fileName) => {
    if (!activeProjectRoot) throw new Error('未打开项目')
    return deleteStyleProbeTarget(activeProjectRoot, fileName)
  })
  ipcMain.handle('style-probe:import-media', async (_event, sourceFilePath, prefix) => {
    if (!activeProjectRoot) throw new Error('未打开项目')
    return importStyleProbeMedia(activeProjectRoot, sourceFilePath, prefix)
  })

  // 音频与系统辅助
  ipcMain.handle('audio-studio:dispatch', async () => ({}))
  ipcMain.handle('os:launch-app', async () => ({}))
  ipcMain.handle('os:stop-app', async () => ({}))
}

async function createWindow(config = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  const isMac = process.platform === 'darwin'
  const window = new BrowserWindow({
    width: config.width ?? 1440,
    height: config.height ?? 900,
    minWidth: 1024,
    minHeight: 700,
    frame: config.frameless === undefined ? false : !config.frameless,
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 11 } : undefined,
    backgroundColor: '#0c0e12',
    title: config.title ?? 'GraphVideo Desktop',
    webPreferences: {
      sandbox: false,
      additionalArguments: [`--graphvideo-context=${process.argv[2]}`],
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow = window
  window.on('close', (event) => {
    if (physicalClosing || closingServices) return;
    event.preventDefault();
    requestQuit();
  })

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer L${level}] ${message} (${sourceId}:${line})`)
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
    if (!acceptingObservations) return
    pendingCloseObservation = physicalClosing ? Promise.resolve() : host.injectHost('src-electron-window', { type: 'ElectronWindowClosedObservedInfo' })
    void pendingCloseObservation.catch((error) => {
      console.error('[GraphVideo] Window close observation failed:', error)
    })
  })

  try {
    if (runOverrides.viteDevServerUrl) {
      await window.loadURL(runOverrides.viteDevServerUrl)
    } else {
      await window.loadFile(application.rendererFile)
    }
  } catch (error) {
    if (!window.isDestroyed()) window.destroy()
    throw error
  }
  return window
}

// This process is a configured frontend host. Bash owns all lifecycle ordering.
app.setPath('userData', frontendContext.userDataDirectory)
getProjectHistory(frontendContext.userDataDirectory)
if (!app.requestSingleInstanceLock()) throw new Error('Frontend instance is already active')
let physicalClosing = false
let closingServices = false
app.on('before-quit', (event) => {
  if (allowQuit) return
  event.preventDefault()
  requestQuit()
})
electronIpcMain.on('window:quit', requestQuit)
app.whenReady().then(async () => {
protocol.handle('graphvideo-asset', handleAssetRequest)
host = await connectFrontendHost({
  rendererReady,
  broadcast,
  inspectLayout: () => mainWindow.webContents.executeJavaScript(`(() => {
    const bounds = (element) => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const active = document.querySelector('.workspace-page.is-active');
    return { viewport: { width: innerWidth, height: innerHeight }, root: bounds(document.getElementById('root')),
      workspace: bounds(active), footer: bounds(document.querySelector('.app-footer')),
      panels: [...(active?.querySelectorAll('.panel-instance.is-active') ?? [])].map(bounds),
      missingPanels: active?.querySelectorAll('.missing-element-panel').length ?? 0 };
  })()`),
  effects: {
    project: { async execute(request) {
      if (request.type !== 'OPEN' || typeof request.path !== 'string') throw new Error('Invalid project host request')
      return openProjectAtPath(request.path)
    } },
    window: { async execute(request, context) {
      physicalClosing = request.type === 'CLOSE'
      try { return await electronWindowAdapter.execute(request, context) }
      finally { physicalClosing = false }
    } },
    generation: generationAdapter,
    sqlite: { async execute(request) {
      if (!activeProjectRoot) throw new Error('SQLite Effect 需要已打开项目')
      return persistGraphMetadata(activeProjectRoot, request.records)
    } },
    structure: { async execute(request) {
      if (!activeProjectRoot) throw new Error('Structure Effect 需要已打开项目')
      return saveProjectStructure(activeProjectRoot, request)
    } },
  },
  stopSources: async () => {
    projectExternalSync.stop()
    await pendingCloseObservation
    acceptingObservations = false
  },
  closeIngress: async () => { commandGate.close(); await commandGate.drain() },
  closeServices: async () => {
    closingServices = true
    commandGate.close()
    await commandGate.drain()
    commandIpc?.dispose()
    electronIpcMain.removeListener('window:quit', requestQuit)
    if (await protocol.isProtocolHandled('graphvideo-asset')) protocol.unhandle('graphvideo-asset')
  },
  quit: () => { allowQuit = true; app.quit() },
})
registerIpcHandlers()
app.on('window-all-closed', () => {})
}).catch(failHost)
