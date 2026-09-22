import { useCallback, useRef, useSyncExternalStore } from 'react'
import {
  CommandRegistry,
  PanelRegistry,
  ExtensionRegistry,
  EventRegistry,
  ServiceRegistry,
  ElementStateRegistry,
  ElementRuntimeManager,
  WorkbenchContextStore,
  registerWorkspaceCommands,
  splitArea,
  closeArea,
  canCloseArea,
  switchAreaPanel,
  resizeSplit,
  swapAreaPanels,
  listAreas,
  type WorkbenchServices,
  type WorkbenchHostAdapter,
  type ClientWorkspaceState,
  type WorkspaceCommandTarget,
  type WorkspaceRuntimeState,
  type ElementHostApi,
  type PanelDefinition,
} from '@graphframework/workbench'

class WorkspaceStore {
  private state: ClientWorkspaceState
  private readonly listeners = new Set<() => void>()

  constructor(initial: ClientWorkspaceState) {
    this.state = initial
  }

  readonly getSnapshot = () => this.state

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setState(updater: (prev: ClientWorkspaceState) => ClientWorkspaceState) {
    this.state = updater(this.state)
    this.listeners.forEach((listener) => listener())
  }
}

let counter = 0
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++counter}`

export interface RecorderWorkbenchAdapter extends WorkbenchHostAdapter {
  getWorkspaceSnapshot: () => ClientWorkspaceState
}

export function createRecorderWorkbenchAdapter(panels: PanelDefinition[]): RecorderWorkbenchAdapter {
  const commands = new CommandRegistry()
  const panelRegistry = new PanelRegistry()
  const extensions = new ExtensionRegistry()
  const elementEvents = new EventRegistry()
  const elementServices = new ServiceRegistry()
  const elementStates = new ElementStateRegistry()
  const contexts = new WorkbenchContextStore()

  const elementHost: ElementHostApi = {
    getProjectId: () => null,
    executeCommand: (id, payload) => commands.execute(id, payload),
  }

  const elementRuntimes = new ElementRuntimeManager(
    elementStates,
    elementHost,
    elementServices,
    elementEvents,
    contexts,
  )

  // 注册统一录制插件下的面板
  for (const p of panels) {
    panelRegistry.register('example.unified-recorder', p)
  }

  void elementRuntimes.replaceFactory('example.unified-recorder', {
    create: () => ({}),
  })

  // 达芬奇/Blender 风格多工作区分页（支持底部坞切换，内部二叉树支持左上角自由页面切换、任意切分与拖拽拖出）
  // 精简双页：控制中枢 + 截图证据（单区全屏，无侧栏）
  const workspaces: Record<string, WorkspaceRuntimeState> = {
    // 1. 控制中枢（全屏单区）
    controls: {
      id: 'controls',
      name: '控制中枢',
      order: 0,
      focusedAreaId: 'area-recorder-controls',
      maximizedAreaId: null,
      layout: {
        kind: 'area',
        id: 'area-recorder-controls',
        activePanelId: 'recorder.controls',
        panelHistory: ['recorder.controls'],
        panelInstanceIds: { 'recorder.controls': 'inst-controls-1' },
      },
    },

    // 2. 截图证据（全屏单区）
    screenshots: {
      id: 'screenshots',
      name: '截图证据',
      order: 1,
      focusedAreaId: 'area-screenshots-solo',
      maximizedAreaId: null,
      layout: {
        kind: 'area',
        id: 'area-screenshots-solo',
        activePanelId: 'recorder.screenshots',
        panelHistory: ['recorder.screenshots'],
        panelInstanceIds: { 'recorder.screenshots': 'inst-screenshots-solo' },
      },
    },
  }

  const store = new WorkspaceStore({
    activeWorkspaceId: 'controls',
    items: workspaces,
  })

  // 对接二叉树命令目标，支持左上角面板自由切换、切分、调整大小、最大化、关闭、拖拽与拖出
  const target: WorkspaceCommandTarget = {
    activate(workspaceId: string) {
      store.setState((prev) => ({ ...prev, activeWorkspaceId: workspaceId }))
    },
    focus(workspaceId: string, areaId: string) {
      store.setState((prev) => {
        const ws = prev.items[workspaceId]
        if (!ws) return prev
        return {
          ...prev,
          items: { ...prev.items, [workspaceId]: { ...ws, focusedAreaId: areaId } },
        }
      })
    },
    switchPanel(workspaceId: string, areaId: string, panelId: string) {
      store.setState((prev) => {
        const ws = prev.items[workspaceId]
        if (!ws) return prev
        const instanceId = nextId(`inst-${areaId}-${panelId}`)
        const newLayout = switchAreaPanel(ws.layout, areaId, panelId, instanceId)
        return {
          ...prev,
          items: {
            ...prev.items,
            [workspaceId]: { ...ws, layout: newLayout, focusedAreaId: areaId },
          },
        }
      })
    },
    splitArea(workspaceId: string, areaId: string, direction: 'horizontal' | 'vertical') {
      store.setState((prev) => {
        const ws = prev.items[workspaceId]
        if (!ws) return prev
        const newAreaId = nextId('area')
        const newSplitId = nextId('split')
        const panelInstanceId = nextId(`inst-${newAreaId}`)
        const newLayout = splitArea(ws.layout, areaId, direction, {
          areaId: newAreaId,
          splitId: newSplitId,
          panelInstanceId,
        })
        return {
          ...prev,
          items: {
            ...prev.items,
            [workspaceId]: { ...ws, layout: newLayout, focusedAreaId: newAreaId },
          },
        }
      })
    },
    closeArea(workspaceId: string, areaId: string) {
      store.setState((prev) => {
        const ws = prev.items[workspaceId]
        if (!ws || !canCloseArea(ws.layout, areaId)) return prev
        const newLayout = closeArea(ws.layout, areaId)
        const remaining = listAreas(newLayout)
        const focusedAreaId =
          ws.focusedAreaId === areaId ? (remaining[0]?.id ?? '') : ws.focusedAreaId
        const maximizedAreaId = ws.maximizedAreaId === areaId ? null : ws.maximizedAreaId
        return {
          ...prev,
          items: {
            ...prev.items,
            [workspaceId]: { ...ws, layout: newLayout, focusedAreaId, maximizedAreaId },
          },
        }
      })
    },
    resizeSplit(workspaceId: string, splitId: string, ratio: number) {
      store.setState((prev) => {
        const ws = prev.items[workspaceId]
        if (!ws) return prev
        const newLayout = resizeSplit(ws.layout, splitId, ratio)
        return {
          ...prev,
          items: {
            ...prev.items,
            [workspaceId]: { ...ws, layout: newLayout },
          },
        }
      })
    },
    swapAreas(workspaceId: string, sourceAreaId: string, targetAreaId: string) {
      store.setState((prev) => {
        const ws = prev.items[workspaceId]
        if (!ws) return prev
        const newLayout = swapAreaPanels(ws.layout, sourceAreaId, targetAreaId)
        return {
          ...prev,
          items: {
            ...prev.items,
            [workspaceId]: { ...ws, layout: newLayout, focusedAreaId: targetAreaId },
          },
        }
      })
    },
    toggleMaximize(workspaceId: string, areaId: string) {
      store.setState((prev) => {
        const ws = prev.items[workspaceId]
        if (!ws) return prev
        const maximizedAreaId = ws.maximizedAreaId === areaId ? null : areaId
        return {
          ...prev,
          items: {
            ...prev.items,
            [workspaceId]: { ...ws, maximizedAreaId, focusedAreaId: areaId },
          },
        }
      })
    },
    readWorkspace(workspaceId: string) {
      return store.getSnapshot().items[workspaceId]
    },
  }

  registerWorkspaceCommands(commands, target, 'core')

  const services: WorkbenchServices = {
    commands,
    panels: panelRegistry,
    extensions,
    elementEvents,
    elementServices,
    elementStates,
    elementRuntimes,
    contexts,
  }

  function shallowEqual(a: any, b: any): boolean {
    if (Object.is(a, b)) return true
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i])) return false
      }
      return true
    }
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    for (const k of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, k) || !Object.is(a[k], b[k])) return false
    }
    return true
  }

  return {
    services,
    getWorkspaceSnapshot: () => store.getSnapshot(),
    useWorkspaceState<T>(selector: (state: ClientWorkspaceState) => T): T {
      const cacheRef = useRef<{ state: ClientWorkspaceState; value: T } | null>(null)
      const selectorRef = useRef(selector)
      selectorRef.current = selector

      const getSnapshot = useCallback(() => {
        const currentState = store.getSnapshot()
        if (cacheRef.current && cacheRef.current.state === currentState) {
          return cacheRef.current.value
        }
        const nextValue = selectorRef.current(currentState)
        if (cacheRef.current && shallowEqual(cacheRef.current.value, nextValue)) {
          cacheRef.current.state = currentState
          return cacheRef.current.value
        }
        cacheRef.current = { state: currentState, value: nextValue }
        return nextValue
      }, [])

      return useSyncExternalStore(store.subscribe, getSnapshot)
    },
  }
}
