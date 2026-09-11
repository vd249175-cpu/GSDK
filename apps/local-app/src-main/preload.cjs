const { contextBridge, ipcRenderer, webUtils } = require('electron')

/**
 * 预加载桥：向渲染进程暴露安全的强类型命令白名单。
 * 杜绝渲染进程直接操作 Node 实例、内核指针或任意私有状态。
 */
contextBridge.exposeInMainWorld('graphvideoDesktop', {
  platform: process.platform,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }),
  windowControls: Object.freeze({
    minimize: () => ipcRenderer.send('window:minimize'),
    reload: () => ipcRenderer.send('window:reload'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
  }),
  graphKernel: Object.freeze({
    request: (method, input) => ipcRenderer.invoke('graph:request', { method, input }),
    subscribe: (event, listener) => {
      const handler = (_ipcEvent, message) => {
        if (message?.event === event) listener(message.payload)
      }
      ipcRenderer.on('graph:event', handler)
      return () => ipcRenderer.removeListener('graph:event', handler)
    },
  }),
  project: Object.freeze({
    openLocal: (projectPath) => ipcRenderer.invoke('project:open-local', projectPath),
    listRecent: () => ipcRenderer.invoke('project:list-recent'),
    restoreLast: () => ipcRenderer.invoke('project:restore-last'),
    listSnapshots: () => ipcRenderer.invoke('project:snapshots-list'),
    createSnapshot: (label) => ipcRenderer.invoke('project:snapshots-create', label),
    branchFromSnapshot: (snapshotId, branchName) => (
      ipcRenderer.invoke('project:snapshots-branch', snapshotId, branchName)
    ),
    importNodeVersion: (nodeId, source) => ipcRenderer.invoke(
      'project:import-node-version',
      nodeId,
      source?.kind === 'local-path' ? source.path : undefined,
    ),
    promoteNodeVersion: (nodeId, versionId) => ipcRenderer.invoke('project:promote-node-version', nodeId, versionId),
    exportCurrentVideos: (nodeIds) => ipcRenderer.invoke('project:export-current-videos', nodeIds),
    copyVersionFiles: (items) => ipcRenderer.invoke('project:copy-version-files', items),
    onExternalUpdate: (callback) => {
      const listener = (_event, project) => callback(project)
      ipcRenderer.on('project:external-update', listener)
      return () => ipcRenderer.removeListener('project:external-update', listener)
    },
    onExternalMarkdownUpdate: (callback) => {
      const listener = (_event, markdown) => callback(markdown)
      ipcRenderer.on('project:external-markdown-update', listener)
      return () => ipcRenderer.removeListener('project:external-markdown-update', listener)
    },
    assetUrl: (nodeId, versionId) => {
      return `graphvideo-asset://node/${encodeURIComponent(nodeId)}/${encodeURIComponent(versionId)}`
    },
  }),
  agent: Object.freeze({
    readClipboardText: () => ipcRenderer.invoke('agent:clipboard-read-text'),
    writeClipboardText: (value) => ipcRenderer.invoke('agent:clipboard-write-text', value),
    resolveDroppedFilePaths: (files) => Array.from(files ?? [], (file) => (
      webUtils.getPathForFile(file)
    )).filter(Boolean),
    discover: () => ipcRenderer.invoke('agent:discover'),
    launchNativeTerminal: (templateId, agentId) => (
      ipcRenderer.invoke('agent:launch-native-terminal', { templateId, agentId })
    ),
    openDirectory: (templateId, agentId) => (
      ipcRenderer.invoke('agent:open-directory', { templateId, agentId })
    ),
  }),
  generationModels: Object.freeze({
    list: () => ipcRenderer.invoke('generation-models:list'),
    evaluateDag: (projectRoot) => ipcRenderer.invoke('generation-models:evaluate-dag', projectRoot),
    prepareBatch: (items, options) => ipcRenderer.invoke('generation-models:prepare-batch', { items, ...options }),
    resolve: (input) => ipcRenderer.invoke('generation-models:resolve', input),
    buildRequest: (input) => ipcRenderer.invoke('generation-models:build-request', input),
    import: () => ipcRenderer.invoke('generation-models:import'),
    delete: (modelId) => ipcRenderer.invoke('generation-models:delete', modelId),
  }),
  promptLibrary: Object.freeze({
    list: () => ipcRenderer.invoke('prompt-library:list'),
    read: (relativePath) => ipcRenderer.invoke('prompt-library:read', relativePath),
    save: (relativePath, content) => ipcRenderer.invoke('prompt-library:save', relativePath, content),
    create: (relativePath, content) => ipcRenderer.invoke('prompt-library:create', relativePath, content),
    createDirectory: (relativePath) => ipcRenderer.invoke('prompt-library:create-directory', relativePath),
    rename: (sourcePath, targetPath) => ipcRenderer.invoke('prompt-library:rename', sourcePath, targetPath),
    delete: (relativePath) => ipcRenderer.invoke('prompt-library:delete', relativePath),
  }),
  elements: Object.freeze({
    list: () => ipcRenderer.invoke('elements:list'),
    refresh: () => ipcRenderer.invoke('elements:refresh'),
  }),
  audioStudio: Object.freeze({
    dispatch: (options) => ipcRenderer.invoke('audio-studio:dispatch', options),
  }),
  styleProbe: Object.freeze({
    listTargets: () => ipcRenderer.invoke('style-probe:list-targets'),
    readTarget: (fileName) => ipcRenderer.invoke('style-probe:read-target', fileName),
    saveTarget: (fileName, content) => ipcRenderer.invoke('style-probe:save-target', fileName, content),
    createTarget: (fileName, title) => ipcRenderer.invoke('style-probe:create-target', fileName, title),
    deleteTarget: (fileName) => ipcRenderer.invoke('style-probe:delete-target', fileName),
    importMedia: (sourceFilePath, prefix) => ipcRenderer.invoke('style-probe:import-media', sourceFilePath, prefix),
    mediaUrl: (relativePath) => {
      const clean = String(relativePath || '').replace(/^media\//, '')
      return `graphvideo-asset://media/${encodeURIComponent(clean)}`
    },
  }),
  os: Object.freeze({
    launchApp: () => ipcRenderer.invoke('os:launch-app'),
    stopApp: () => ipcRenderer.invoke('os:stop-app'),
  }),
})

// 兼容通道保留
contextBridge.exposeInMainWorld('graph', {
  incrementCounter: () => ipcRenderer.invoke('counter/increment'),
  readCounter: () => ipcRenderer.invoke('counter/state'),
})
contextBridge.exposeInMainWorld('shell', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
})
