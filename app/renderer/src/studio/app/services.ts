import {
  DesktopAdapter, onExternalProjectMarkdownUpdate, onExternalProjectUpdate,
} from '../core/system/desktopAdapter'
import {
  CommandRegistry, ElementLoader, ElementRuntimeManager, ExtensionRegistry,
  EventRegistry, PanelRegistry, ServiceRegistry, ElementStateRegistry,
  WorkbenchContextStore, PluginRuntimeManager,
  saveActiveWorkspacePreference, saveWorkspaceDefault,
  type ElementHostApi,
} from '@graphvideo/workbench'
import { desktopElementSource } from './elementSource'
import { restoreLastProjectAtStartup } from './projectStartup'
import { ApplicationHost } from '../application/host/applicationHost'
import { registerApplicationHandlers } from '../application/host/registerApplicationHandlers'
import {
  KernelApplicationGraphHost, type GraphKernelBridge,
} from '../application/graph/graphHost'
import { initialKernelApplicationState } from '../application/graph/application-state-projection'
import { graphVideoRuntimeNodeIds } from '../graph/node-ids'
import { InProcessTransport } from '../application/transport/inProcessTransport'
import { createProjectAssetsService } from '../application/services/projectAssetsService'
import { createDesktopApplicationServices } from '../application/services/applicationServices'
import {
  ApplicationSnapshotStore, createApplicationClient,
} from '../client/app/applicationClient'
import { desktopShell } from '../client/shell/desktopShell'
import { ClientStateStore } from '../client/state/clientStateStore'
import { ClientWorkspaceHistory } from '../client/state/clientWorkspaceHistory'
import { ClientWorkspaceController } from '../client/state/workspaceController'
import { ClientHistoryCoordinator } from '../client/state/clientHistoryCoordinator'
import { ClientTransport } from '../client/app/clientTransport'

const desktop = new DesktopAdapter()
const commands = new CommandRegistry()
const panels = new PanelRegistry()
const extensions = new ExtensionRegistry()
const elementEvents = new EventRegistry()
const elementStates = new ElementStateRegistry()
const elementServices = new ServiceRegistry()
const workbenchContexts = new WorkbenchContextStore()
const applicationHost = new ApplicationHost()

const unavailableKernelBridge: GraphKernelBridge = {
  request: async () => {
    throw new Error('Causal Graph Runtime bridge 未挂载，Studio 无权在 renderer 内执行 Node.change')
  },
  subscribe: () => () => undefined,
} as GraphKernelBridge

const desktopBridge = typeof window !== 'undefined' ? window.graphvideoDesktop : undefined
const graphHost = new KernelApplicationGraphHost(
  desktopBridge?.graphKernel ?? unavailableKernelBridge,
)
const projectAssets = createProjectAssetsService(desktopBridge?.project)
const applicationServices = createDesktopApplicationServices(
  desktopBridge,
  projectAssets,
  (payload) => applicationHost.emit('generation-models.catalog-changed', payload),
)
const stopApplicationHandlers = registerApplicationHandlers({
  host: applicationHost,
  graph: graphHost,
  projectPersistence: desktop,
  services: applicationServices,
})
const clientState = new ClientStateStore()
const applicationTransport = new InProcessTransport(applicationHost)
const clientTransport = new ClientTransport(applicationTransport, clientState)
const applicationClient = createApplicationClient(clientTransport)
const clientHistory = new ClientWorkspaceHistory(clientState)
const workspace = new ClientWorkspaceController(clientState, clientHistory)
const clientHistoryCoordinator = new ClientHistoryCoordinator(applicationClient, clientHistory)
const applicationSnapshots = new ApplicationSnapshotStore(clientTransport, {
  revision: 0,
  state: initialKernelApplicationState(),
  history: graphHost.history.read().snapshot,
})
const elementHost: ElementHostApi = {
  getProjectId: () => graphHost.projection.read().project.localPath,
  executeCommand: (id, payload) => commands.execute(id, payload),
}
const elementRuntimes = new ElementRuntimeManager(
  elementStates, elementHost, elementServices, elementEvents, workbenchContexts,
)
const stopExternalProjectUpdates = onExternalProjectUpdate((project) => {
  clientState.setMarkdownDraft(project.path, project.markdown)
  void graphHost.injectRootInfo(graphVideoRuntimeNodeIds.projectSession, {
    type: 'ProjectOpenedInfo', project,
  }).catch(() => undefined)
})
const stopExternalMarkdownUpdates = onExternalProjectMarkdownUpdate((markdown) => {
  clientState.setMarkdownDraft(graphHost.projection.read().project.localPath, markdown)
  void graphHost.injectRootInfo(graphVideoRuntimeNodeIds.document, {
    type: 'UserMarkdownEditedInfo', markdown,
  }).catch(() => undefined)
})
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    stopExternalProjectUpdates()
    stopExternalMarkdownUpdates()
    void elementRuntimes.disposeAll()
    applicationSnapshots.dispose()
    clientHistoryCoordinator.dispose()
    applicationTransport.dispose()
    stopApplicationHandlers()
    applicationHost.dispose()
    graphHost.dispose()
  }, { once: true })
}
const elements = new ElementLoader({
  panels,
  extensions,
  events: elementEvents,
  states: elementStates,
  services: elementServices,
  commands,
  runtimes: elementRuntimes,
  host: elementHost,
  application: applicationClient,
  contexts: workbenchContexts,
})
const plugins = new PluginRuntimeManager({ elementLoader: elements, contextStore: workbenchContexts })
elementEvents.setFailureReporter(({ eventId, owner, error }) => {
  const message = error instanceof Error ? error.message : String(error)
  elements.reportError(`Event Listener 失败: ${eventId} (${owner}) - ${message}`)
})
commands.register<string>('workspace.activate', (workspaceId) => {
  workspace.activate(workspaceId)
  saveActiveWorkspacePreference(workspaceId)
})

commands.register<string>('workspace.layout.save-default', (workspaceId) => {
  const value = clientState.read().workspace.items[workspaceId]
  if (!value) throw new Error(`工作区不存在：${workspaceId}`)
  saveWorkspaceDefault(value)
})

commands.register<{ workspaceId: string; areaId: string }>(
  'workspace.area.focus',
  ({ workspaceId, areaId }) => workspace.focus(workspaceId, areaId),
)

commands.register<{ workspaceId: string; areaId: string; panelId: string }>(
  'workspace.panel.switch', ({ workspaceId, areaId, panelId }) => (
    workspace.switchPanel(workspaceId, areaId, panelId)
  ),
)

commands.register<{
  workspaceId: string
  areaId: string
  direction: 'horizontal' | 'vertical'
}>('workspace.area.split', ({ workspaceId, areaId, direction }) => (
  workspace.splitArea(workspaceId, areaId, direction)
))

commands.register<{ workspaceId: string; areaId: string }>(
  'workspace.area.close', ({ workspaceId, areaId }) => workspace.closeArea(workspaceId, areaId),
)

commands.register<{
  workspaceId: string
  splitId: string
  ratio: number
  historyGroupId?: string
}>(
  'workspace.split.resize', ({ workspaceId, splitId, ratio, historyGroupId }) => (
    workspace.resizeSplit(workspaceId, splitId, ratio, historyGroupId)
  ),
)

commands.register<{
  workspaceId: string
  sourceAreaId: string
  targetAreaId: string
}>('workspace.area.swap', ({ workspaceId, sourceAreaId, targetAreaId }) => (
  workspace.swapAreas(workspaceId, sourceAreaId, targetAreaId)
))

commands.register<{ workspaceId: string; areaId: string }>(
  'workspace.area.maximize', ({ workspaceId, areaId }) => (
    workspace.toggleMaximize(workspaceId, areaId)
  ),
)

export const appServices = {
  history: clientHistoryCoordinator,
  commands,
  panels,
  extensions,
  elementEvents,
  elementStates,
  elementServices,
  workbenchContexts,
  applicationClient,
  graphHost,
  applicationSnapshots,
  clientState,
  clientHistory,
  workspace,
  shell: desktopShell,
  elementRuntimes,
  elements,
  plugins,
  initialize: initializeApplication,
}
export type AppServices = typeof appServices

let initialization: Promise<void> | null = null

function initializeApplication() {
  if (!initialization) {
    const connectKernel = graphHost.connect()
    const loadElements = desktopElementSource.start(elements, clientState, plugins).catch((error: unknown) => {
      elements.reportError(error instanceof Error ? error.message : 'Element 初始化失败')
    })
    const restoreProject = connectKernel.then(() => restoreLastProjectAtStartup(
      () => desktop.restoreLastProject(),
      (project) => graphHost.injectRootInfo(graphVideoRuntimeNodeIds.projectSession, {
        type: 'ProjectOpenedInfo', project,
      }),
    )).catch(() => undefined)
    initialization = Promise.all([connectKernel, loadElements, restoreProject])
      .then(() => applicationSnapshots.refresh())
      .then(() => undefined)
  }
  return initialization
}
