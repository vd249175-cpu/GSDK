import type { DockNode, WorkspaceRuntimeState } from '../dock/workspaceTypes'

interface SourceArea {
  kind: 'area'
  id: string
  panelId: string
  instanceId: string
}

interface SourceSplit {
  kind: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  ratio: number
  first: SourceDockNode
  second: SourceDockNode
}

type SourceDockNode = SourceArea | SourceSplit

export interface WorkspaceDefinition {
  id: string
  name: string
  order: number
  layout: SourceDockNode
}

const idPattern = /^[a-z0-9][a-z0-9._-]*$/

function parseNode(raw: unknown, ids: Set<string>): SourceDockNode {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Workspace layout 节点必须是对象')
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || !idPattern.test(value.id) || ids.has(value.id)) {
    throw new Error(`Workspace layout ID 无效或重复: ${String(value.id)}`)
  }
  ids.add(value.id)
  if (value.kind === 'area') {
    if (
      typeof value.panelId !== 'string' || !idPattern.test(value.panelId)
      || typeof value.instanceId !== 'string' || !idPattern.test(value.instanceId)
    ) {
      throw new Error(`Workspace Area ${value.id} 缺少 panelId/instanceId`)
    }
    return { kind: 'area', id: value.id, panelId: value.panelId, instanceId: value.instanceId }
  }
  if (value.kind !== 'split' || (value.direction !== 'horizontal' && value.direction !== 'vertical')) {
    throw new Error(`Workspace 节点 ${value.id} 的 kind/direction 无效`)
  }
  if (typeof value.ratio !== 'number' || value.ratio < 0.15 || value.ratio > 0.85) {
    throw new Error(`Workspace Split ${value.id} 的 ratio 必须在 0.15 到 0.85 之间`)
  }
  return {
    kind: 'split',
    id: value.id,
    direction: value.direction,
    ratio: value.ratio,
    first: parseNode(value.first, ids),
    second: parseNode(value.second, ids),
  }
}

export function parseWorkspaceDefinition(folderId: string, text: string): WorkspaceDefinition {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(`Workspace ${folderId} 的 workspace.json 不是有效 JSON`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Workspace ${folderId} 必须是对象`)
  const value = raw as Record<string, unknown>
  if (value.id !== folderId || typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error(`Workspace ${folderId} 的 id/name 无效`)
  }
  if (typeof value.order !== 'number' || !Number.isFinite(value.order)) {
    throw new Error(`Workspace ${folderId} 的 order 无效`)
  }
  return {
    id: folderId,
    name: value.name.trim(),
    order: value.order,
    layout: parseNode(value.layout, new Set()),
  }
}

function toRuntimeNode(node: SourceDockNode): DockNode {
  if (node.kind === 'area') {
    return {
      kind: 'area',
      id: node.id,
      activePanelId: node.panelId,
      panelHistory: [node.panelId],
      panelInstanceIds: { [node.panelId]: node.instanceId },
    }
  }
  return { ...node, first: toRuntimeNode(node.first), second: toRuntimeNode(node.second) }
}

function firstAreaId(node: SourceDockNode): string {
  return node.kind === 'area' ? node.id : firstAreaId(node.first)
}

export function createWorkspaceRuntime(definition: WorkspaceDefinition): WorkspaceRuntimeState {
  return {
    id: definition.id,
    name: definition.name,
    order: definition.order,
    layout: toRuntimeNode(definition.layout),
    focusedAreaId: firstAreaId(definition.layout),
    maximizedAreaId: null,
  }
}
