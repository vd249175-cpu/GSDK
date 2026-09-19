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

export interface DemoWorkbenchAdapter extends WorkbenchHostAdapter {
  getWorkspaceSnapshot: () => ClientWorkspaceState
}

export function createDemoWorkbenchAdapter(panels: PanelDefinition[]): DemoWorkbenchAdapter {
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

  // 注册 Demo 拓扑插件下的面板
  for (const p of panels) {
    panelRegistry.register('demo.topology', p)
  }

  void elementRuntimes.replaceFactory('demo.topology', {
    create: () => ({}),
  })

  // 达芬奇/Blender 风格多工作区分页（支持底部坞切换，内部支持任意二叉树无限切分拖拽）
  const workspaces: Record<string, WorkspaceRuntimeState> = {
    // 1. 经典工作台：左侧故事，右侧上下分屏（上星盘，下总账）
    editing: {
      id: 'editing',
      name: '万象工台',
      order: 0,
      focusedAreaId: 'area-astrolabe',
      maximizedAreaId: null,
      layout: {
        kind: 'split',
        id: 'split-editing-root',
        direction: 'horizontal',
        ratio: 0.36,
        first: {
          kind: 'area',
          id: 'area-prophecy',
          activePanelId: 'demo.prophecy',
          panelHistory: ['demo.prophecy'],
          panelInstanceIds: { 'demo.prophecy': 'inst-prophecy-1' },
        },
        second: {
          kind: 'split',
          id: 'split-editing-right',
          direction: 'vertical',
          ratio: 0.58,
          first: {
            kind: 'area',
            id: 'area-astrolabe',
            activePanelId: 'demo.astrolabe',
            panelHistory: ['demo.astrolabe'],
            panelInstanceIds: { 'demo.astrolabe': 'inst-astrolabe-1' },
          },
          second: {
            kind: 'area',
            id: 'area-chronicle',
            activePanelId: 'demo.chronicle',
            panelHistory: ['demo.chronicle'],
            panelInstanceIds: { 'demo.chronicle': 'inst-chronicle-1' },
          },
        },
      },
    },

    // 2. 预言专页
    prophecy: {
      id: 'prophecy',
      name: '预言编织',
      order: 1,
      focusedAreaId: 'area-prophecy-solo',
      maximizedAreaId: null,
      layout: {
        kind: 'area',
        id: 'area-prophecy-solo',
        activePanelId: 'demo.prophecy',
        panelHistory: ['demo.prophecy'],
        panelInstanceIds: { 'demo.prophecy': 'inst-prophecy-solo' },
      },
    },

    // 3. 因果星盘专页（支持左右对比）
    astrolabe: {
      id: 'astrolabe',
      name: '因果星盘',
      order: 2,
      focusedAreaId: 'area-astrolabe-solo',
      maximizedAreaId: null,
      layout: {
        kind: 'split',
        id: 'split-astro-root',
        direction: 'horizontal',
        ratio: 0.7,
        first: {
          kind: 'area',
          id: 'area-astrolabe-solo',
          activePanelId: 'demo.astrolabe',
          panelHistory: ['demo.astrolabe'],
          panelInstanceIds: { 'demo.astrolabe': 'inst-astrolabe-solo' },
        },
        second: {
          kind: 'area',
          id: 'area-astro-side',
          activePanelId: 'demo.pantheon',
          panelHistory: ['demo.pantheon'],
          panelInstanceIds: { 'demo.pantheon': 'inst-astro-side' },
        },
      },
    },

    // 4. 神格示波专页
    pantheon: {
      id: 'pantheon',
      name: '神格示波',
      order: 3,
      focusedAreaId: 'area-pantheon-solo',
      maximizedAreaId: null,
      layout: {
        kind: 'split',
        id: 'split-pantheon-root',
        direction: 'horizontal',
        ratio: 0.65,
        first: {
          kind: 'area',
          id: 'area-pantheon-solo',
          activePanelId: 'demo.pantheon',
          panelHistory: ['demo.pantheon'],
          panelInstanceIds: { 'demo.pantheon': 'inst-pantheon-solo' },
        },
        second: {
          kind: 'area',
          id: 'area-pantheon-kernel',
          activePanelId: 'demo.kernel',
          panelHistory: ['demo.kernel'],
          panelInstanceIds: { 'demo.kernel': 'inst-pantheon-kernel' },
        },
      },
    },

    // 5. 万象编年专页
    chronicle: {
      id: 'chronicle',
      name: '万象编年',
      order: 4,
      focusedAreaId: 'area-chronicle-solo',
      maximizedAreaId: null,
      layout: {
        kind: 'area',
        id: 'area-chronicle-solo',
        activePanelId: 'demo.chronicle',
        panelHistory: ['demo.chronicle'],
        panelInstanceIds: { 'demo.chronicle': 'inst-chronicle-solo' },
      },
    },

    // 6. 内核基石专页
    sandbox: {
      id: 'sandbox',
      name: '内核基石',
      order: 5,
      focusedAreaId: 'area-kernel-solo',
      maximizedAreaId: null,
      layout: {
        kind: 'area',
        id: 'area-kernel-solo',
        activePanelId: 'demo.kernel',
        panelHistory: ['demo.kernel'],
        panelInstanceIds: { 'demo.kernel': 'inst-kernel-solo' },
      },
    },
  }

  const store = new WorkspaceStore({
    activeWorkspaceId: 'editing',
    items: workspaces,
  })

  // 组装对接 Workbench 的二叉树命令目标
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
