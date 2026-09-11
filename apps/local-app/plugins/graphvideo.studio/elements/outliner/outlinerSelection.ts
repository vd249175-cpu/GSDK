import type { ProjectTreeEditOperation, ProjectTreeItem } from '@graphvideo/client-sdk'

function flatten(tree: ProjectTreeItem[]): ProjectTreeItem[] {
  return tree.flatMap((item) => [item, ...flatten(item.children)])
}

export function focusKeyAfterTreeEdit(
  operation: ProjectTreeEditOperation,
  currentKey: string,
) {
  return operation.type === 'create' || operation.type === 'delete' ? '' : currentKey
}

export function resolveOutlinerSelection(
  tree: ProjectTreeItem[],
  focusedKey: string,
  selectedNodeId: string | null,
) {
  const items = flatten(tree)
  return items.find((item) => item.key === focusedKey)
    ?? items.find((item) => item.nodeId === selectedNodeId)
    ?? null
}
