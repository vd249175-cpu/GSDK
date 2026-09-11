import type { DockNode, WorkspaceRuntimeState } from '../dock/workspaceTypes'
import { listAreas } from '../dock/layout'

const storageKey = 'graphvideo-workspace-default-layouts-v1'
const activeWorkspaceStorageKey = 'graphvideo-active-workspace-v1'

interface StoredWorkspaceLayout {
  layout: DockNode
  focusedAreaId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isDockNode(value: unknown, ids = new Set<string>()): value is DockNode {
  if (!isRecord(value) || typeof value.id !== 'string' || ids.has(value.id)) return false
  ids.add(value.id)
  if (value.kind === 'area') {
    const panelInstanceIds = value.panelInstanceIds
    if (
      typeof value.activePanelId !== 'string'
      || !Array.isArray(value.panelHistory)
      || !value.panelHistory.every((panelId) => typeof panelId === 'string')
      || !value.panelHistory.includes(value.activePanelId)
      || !isRecord(panelInstanceIds)
    ) return false
    return value.panelHistory.every((panelId) => typeof panelInstanceIds[panelId] === 'string')
  }
  return value.kind === 'split'
    && (value.direction === 'horizontal' || value.direction === 'vertical')
    && typeof value.ratio === 'number'
    && value.ratio >= 0.15
    && value.ratio <= 0.85
    && isDockNode(value.first, ids)
    && isDockNode(value.second, ids)
}

function readAll(): Record<string, StoredWorkspaceLayout> {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return {}
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    return isRecord(parsed) ? parsed as Record<string, StoredWorkspaceLayout> : {}
  } catch {
    return {}
  }
}

export function loadWorkspaceDefault(workspaceId: string): StoredWorkspaceLayout | null {
  const stored: unknown = readAll()[workspaceId]
  if (!isRecord(stored) || !isDockNode(stored.layout)) return null
  const areas = listAreas(stored.layout)
  const focusedAreaId = typeof stored.focusedAreaId === 'string'
    && areas.some((area) => area.id === stored.focusedAreaId)
    ? stored.focusedAreaId
    : areas[0]?.id
  return focusedAreaId ? { layout: stored.layout, focusedAreaId } : null
}

export function saveWorkspaceDefault(workspace: WorkspaceRuntimeState) {
  const stored = readAll()
  stored[workspace.id] = {
    layout: workspace.layout,
    focusedAreaId: workspace.focusedAreaId,
  }
  if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
    localStorage.setItem(storageKey, JSON.stringify(stored))
  }
}

export function loadActiveWorkspacePreference() {
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return null
  const workspaceId = localStorage.getItem(activeWorkspaceStorageKey)
  return workspaceId?.trim() || null
}

export function saveActiveWorkspacePreference(workspaceId: string) {
  if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
    localStorage.setItem(activeWorkspaceStorageKey, workspaceId)
  }
}
