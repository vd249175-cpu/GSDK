import type { ClientWorkspaceState, WorkspaceRuntimeState } from './workspaceTypes'

export interface ClientState {
  selectionByProjectPath: Record<string, string | null>
  markdownDraftByProjectPath: Record<string, string>
  workspace: ClientWorkspaceState
  connection: {
    status: 'connected' | 'disconnected'
    pendingRequests: number
    error: string | null
  }
}

type ClientStateListener = () => void

const selectionStorageKey = 'graphvideo.client.selection.v1'

function loadSelections(): Record<string, string | null> {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return {}
    const value = JSON.parse(localStorage.getItem(selectionStorageKey) ?? '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

export class ClientStateStore {
  private state: ClientState = {
    selectionByProjectPath: loadSelections(),
    markdownDraftByProjectPath: {},
    workspace: { activeWorkspaceId: '', items: {} },
    connection: { status: 'connected', pendingRequests: 0, error: null },
  }
  private readonly listeners = new Set<ClientStateListener>()

  read = () => this.state

  subscribe = (listener: ClientStateListener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  selectNode(projectPath: string | null, nodeId: string | null) {
    const key = projectPath || 'current'
    if (Object.hasOwn(this.state.selectionByProjectPath, key)
      && this.state.selectionByProjectPath[key] === nodeId) return
    const selectionByProjectPath = {
      ...this.state.selectionByProjectPath,
      [key]: nodeId,
      ...(projectPath ? { [projectPath]: nodeId } : {}),
    }
    this.update({ ...this.state, selectionByProjectPath })
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(selectionStorageKey, JSON.stringify(selectionByProjectPath))
    }
  }

  setMarkdownDraft(projectPath: string | null, markdown: string) {
    if (!projectPath) return
    this.update({
      ...this.state,
      markdownDraftByProjectPath: {
        ...this.state.markdownDraftByProjectPath,
        [projectPath]: markdown,
      },
    })
  }

  replaceWorkspaces(workspace: ClientWorkspaceState) {
    this.update({ ...this.state, workspace })
  }

  requestStarted() {
    this.update({
      ...this.state,
      connection: {
        status: 'connected',
        pendingRequests: this.state.connection.pendingRequests + 1,
        error: null,
      },
    })
  }

  requestFinished(error?: unknown) {
    const errorCode = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''
    this.update({
      ...this.state,
      connection: {
        status: errorCode.startsWith('transport.') ? 'disconnected' : 'connected',
        pendingRequests: Math.max(0, this.state.connection.pendingRequests - 1),
        error: error instanceof Error ? error.message : error ? 'Application 请求失败' : null,
      },
    })
  }

  activateWorkspace(workspaceId: string) {
    if (!this.state.workspace.items[workspaceId]) return
    this.update({
      ...this.state,
      workspace: { ...this.state.workspace, activeWorkspaceId: workspaceId },
    })
  }

  updateWorkspace(
    workspaceId: string,
    update: (workspace: WorkspaceRuntimeState) => WorkspaceRuntimeState,
  ) {
    const current = this.state.workspace.items[workspaceId]
    if (!current) return
    const next = update(current)
    if (Object.is(current, next)) return
    this.update({
      ...this.state,
      workspace: {
        ...this.state.workspace,
        items: { ...this.state.workspace.items, [workspaceId]: next },
      },
    })
  }

  private update(next: ClientState) {
    if (Object.is(next, this.state)) return
    this.state = next
    this.listeners.forEach((listener) => listener())
  }
}
