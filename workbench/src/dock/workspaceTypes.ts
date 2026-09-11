export interface AreaState {
  kind: 'area'
  id: string
  activePanelId: string
  panelHistory: string[]
  panelInstanceIds: Record<string, string>
}

export interface DockSplitState {
  kind: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  ratio: number
  first: DockNode
  second: DockNode
}

export type DockNode = AreaState | DockSplitState

export interface WorkspaceRuntimeState {
  id: string
  name: string
  order: number
  layout: DockNode
  focusedAreaId: string
  maximizedAreaId: string | null
}

export interface ClientWorkspaceState {
  activeWorkspaceId: string
  items: Record<string, WorkspaceRuntimeState>
}
