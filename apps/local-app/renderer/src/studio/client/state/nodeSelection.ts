import type { ProjectNode, ProjectTreeItem } from '../../core/project/types'

/** Resolve UI/tree identities before storing the shared, canonical selection. */
export function resolveSelectedNodeId(
  preferred: string | null,
  nodes: Record<string, ProjectNode>,
  tree: readonly ProjectTreeItem[],
): string | null {
  if (preferred === null) return null
  if (nodes[preferred]) return preferred
  const byTitle = (title: string, type?: ProjectNode['type']) => (
    Object.values(nodes).find((node) => node.title === title && (!type || node.type === type))?.id
  )
  const automatic = /^(?:auto|unmapped):([$@%~&]):(.+)$/.exec(preferred)
  if (automatic) {
    const types: Record<string, ProjectNode['type']> = {
      '$': 'text', '@': 'image', '%': 'video', '~': 'audio', '&': 'style',
    }
    const resolved = byTitle(automatic[2], types[automatic[1]])
    if (resolved) return resolved
  }
  const findInTree = (items: readonly ProjectTreeItem[]): string | undefined => {
    for (const item of items) {
      if (item.key === preferred || item.nodeId === preferred) {
        if (item.nodeId && nodes[item.nodeId]) return item.nodeId
        const resolved = byTitle(item.title, item.nodeType)
        if (resolved) return resolved
      }
      const child = findInTree(item.children)
      if (child) return child
    }
    return undefined
  }
  return findInTree(tree) ?? byTitle(preferred) ?? null
}
