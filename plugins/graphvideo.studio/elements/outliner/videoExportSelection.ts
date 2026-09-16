import type { ProjectNode, ProjectTreeItem } from '@graphvideo/client-sdk'

export function orderedVideoNodeIds(tree: ProjectTreeItem[], nodes: Record<string, ProjectNode>) {
  const result: string[] = []
  const seen = new Set<string>()
  const videosByTitle = new Map<string, ProjectNode[]>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'video') continue
    const matches = videosByTitle.get(node.title) ?? []
    matches.push(node)
    videosByTitle.set(node.title, matches)
  }
  function visit(items: ProjectTreeItem[]) {
    for (const item of items) {
      if (item.kind === 'node' && item.nodeType === 'video') {
        let node = item.nodeId ? nodes[item.nodeId] : undefined
        if (!node && (!item.nodeId || /^(?:auto|unmapped):%:/.test(item.nodeId))) {
          const matches = videosByTitle.get(item.title) ?? []
          if (matches.length === 1) node = matches[0]
        }
        if (node?.type === 'video' && !seen.has(node.id)) {
          seen.add(node.id)
          result.push(node.id)
        }
      }
      visit(item.children)
    }
  }
  visit(tree)
  return result
}
