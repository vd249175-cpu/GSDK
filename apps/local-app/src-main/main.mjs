import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNativeGraphHost } from './native-graph-host.mjs'
import { NodeGenerationAdapter } from './effects/node-generation-adapter.js'
import studioPlugin from '../plugins/graphvideo.studio/backend.js'
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
import { ElementCatalog } from './services/element-catalog.mjs'
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

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')

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
  comfyApiKey: process.env.COMFY_API_KEY,
})

// 初始化基于 Rust 原生微内核 (NativeRuleSpace) 的 Studio 宿主
const host = createNativeGraphHost({
  dependencies: {
    generationAdapterOperation: generationAdapter,
    sqlitePersistAdapter: {
      id: 'effect:adapter:sqlite-metadata',
      async execute(request, context) {
        if (!activeProjectRoot) throw new Error('SQLite Remote Effect 需要已打开项目')
        return persistGraphMetadata(activeProjectRoot, request?.records)
      },
    },
    projectStructurePersistAdapter: {
      id: 'effect:adapter:project-structure',
      async execute(request, context) {
        if (!activeProjectRoot) throw new Error('Project Structure Effect 需要已打开项目')
        return saveProjectStructure(activeProjectRoot, request)
      },
    },
  },
  plugins: [studioPlugin],
})

async function openProjectAtPath(projectPath) {
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

// 注册 IPC 通道
function registerIpcHandlers() {
  // 窗口基础控制
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:toggle-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.on('window:reload', () => mainWindow?.webContents.reload())

  // 微内核因果通信接口
  ipcMain.handle('graph:request', async (_event, { method, input }) => {
    switch (method) {
      case 'graph.injectRootInfo': {
        const result = await host.injectRoot(input.targetNodeId, input.info, input.submissionId)
        return {
          status: 'accepted',
          submissionId: input.submissionId || 'root-sub',
          projection: host.readProjection(),
        }
      }
      case 'graph.projection.read':
        return { projection: host.readProjection() }
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
    pluginsRoot: join(appRoot, 'plugins'),
    pluginIds: ['graphvideo.studio'],
  })
  ipcMain.handle('elements:list', async () => elementCatalog.scan())
  ipcMain.handle('elements:refresh', async () => elementCatalog.scan())

  // 模型库接口
  const modelsDir = join(appRoot, 'resources', 'generation-models')
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
  const templatesRoot = join(appRoot, 'resources', 'templates')
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
  const promptLibraryRoot = join(appRoot, 'resources', 'prompt-library')
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

async function createWindow() {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    titleBarStyle: isMac ? 'hidden' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 11 } : undefined,
    backgroundColor: '#0c0e12',
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer L${level}] ${message} (${sourceId}:${line})`)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    await mainWindow.loadFile(join(here, '../renderer-dist/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    registerIpcHandlers()
    protocol.handle('graphvideo-asset', handleAssetRequest)
    await createWindow()
  })
}

app.on('window-all-closed', () => {
  projectExternalSync.stop()
  void host.dispose()
  if (process.platform !== 'darwin') app.quit()
})
