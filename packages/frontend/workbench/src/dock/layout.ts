import type { AreaState, DockNode, DockSplitState } from './workspaceTypes'

export function listAreas(node: DockNode): AreaState[] {
  return node.kind === 'area' ? [node] : [...listAreas(node.first), ...listAreas(node.second)]
}

export function findArea(node: DockNode, areaId: string): AreaState | null {
  if (node.kind === 'area') return node.id === areaId ? node : null
  return findArea(node.first, areaId) ?? findArea(node.second, areaId)
}

export function excludeAreas(node: DockNode, excludedAreaIds: ReadonlySet<string>): DockNode | null {
  if (node.kind === 'area') return excludedAreaIds.has(node.id) ? null : node
  const first = excludeAreas(node.first, excludedAreaIds)
  const second = excludeAreas(node.second, excludedAreaIds)
  if (!first) return second
  if (!second) return first
  if (first === node.first && second === node.second) return node
  return { ...node, first, second }
}

export function canCloseArea(layout: DockNode, areaId: string) {
  return Boolean(findArea(layout, areaId)) && listAreas(layout).length > 1
}

function mapArea(node: DockNode, areaId: string, update: (area: AreaState) => DockNode): DockNode {
  if (node.kind === 'area') return node.id === areaId ? update(node) : node
  return {
    ...node,
    first: mapArea(node.first, areaId, update),
    second: mapArea(node.second, areaId, update),
  }
}

export function switchAreaPanel(layout: DockNode, areaId: string, panelId: string, instanceId: string) {
  return mapArea(layout, areaId, (area) => ({
    ...area,
    activePanelId: panelId,
    panelHistory: area.panelHistory.includes(panelId)
      ? area.panelHistory
      : [...area.panelHistory, panelId],
    panelInstanceIds: area.panelInstanceIds[panelId]
      ? area.panelInstanceIds
      : { ...area.panelInstanceIds, [panelId]: instanceId },
  }))
}

export function splitArea(
  layout: DockNode,
  areaId: string,
  direction: DockSplitState['direction'],
  ids: { areaId: string; splitId: string; panelInstanceId: string },
) {
  return mapArea(layout, areaId, (area) => ({
    kind: 'split',
    id: ids.splitId,
    direction,
    ratio: 0.5,
    first: area,
    second: {
      kind: 'area',
      id: ids.areaId,
      activePanelId: area.activePanelId,
      panelHistory: [area.activePanelId],
      panelInstanceIds: { [area.activePanelId]: ids.panelInstanceId },
    },
  }))
}

function closeAreaNode(layout: DockNode, areaId: string): DockNode {
  if (layout.kind === 'area') return layout
  if (layout.first.kind === 'area' && layout.first.id === areaId) return layout.second
  if (layout.second.kind === 'area' && layout.second.id === areaId) return layout.first
  return {
    ...layout,
    first: closeAreaNode(layout.first, areaId),
    second: closeAreaNode(layout.second, areaId),
  }
}

export function closeArea(layout: DockNode, areaId: string): DockNode {
  return canCloseArea(layout, areaId) ? closeAreaNode(layout, areaId) : layout
}

export function resizeSplit(layout: DockNode, splitId: string, ratio: number): DockNode {
  if (layout.kind === 'area') return layout
  if (layout.id === splitId) return { ...layout, ratio: Math.min(0.85, Math.max(0.15, ratio)) }
  return {
    ...layout,
    first: resizeSplit(layout.first, splitId, ratio),
    second: resizeSplit(layout.second, splitId, ratio),
  }
}

export function swapAreaPanels(layout: DockNode, firstId: string, secondId: string): DockNode {
  const first = findArea(layout, firstId)
  const second = findArea(layout, secondId)
  if (!first || !second || first.id === second.id) return layout
  return mapArea(mapArea(layout, firstId, (area) => ({
    ...area,
    activePanelId: second.activePanelId,
    panelHistory: second.panelHistory,
    panelInstanceIds: second.panelInstanceIds,
  })), secondId, (area) => ({
    ...area,
    activePanelId: first.activePanelId,
    panelHistory: first.panelHistory,
    panelInstanceIds: first.panelInstanceIds,
  }))
}
