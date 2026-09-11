import { type NodeVersion, type ProjectNode, type ProjectTreeItem } from '@graphvideo/client-sdk'
import { orderedGenerationReferenceIds } from '../../../../app/shared/generation-reference-order.mjs'

export interface GenerationReference {
  node: ProjectNode
  sourceIndex: number
  ordinal: number
  currentVersion?: NodeVersion
}

// Node IDs are alphanumeric with underscores and hyphens. Punctuation (. : , ; ! ? etc.) are boundaries.
const idCharacter = /[\p{L}\p{N}_-]/u

const typePrefix: Record<string, string> = {
  text: '$',
  image: '@',
  video: '%',
  audio: '~',
  style: '&',
}

function isBoundary(value: string | undefined) {
  return value === undefined || !idCharacter.test(value)
}

export interface GenericPromptReference {
  id: string
  type: string
  title: string
  ordinal: number
  content?: string
}

/** Build aliases in dependency order while numbering each asset kind independently. */
export function generationModelReferences(
  dependencyIds: readonly string[],
  nodes: Record<string, ProjectNode>,
): GenericPromptReference[] {
  const ordinals: Record<string, number> = {}
  const nodesById = new Map(Object.values(nodes).map((node) => [node.id, node]))
  return dependencyIds.map((nodeId) => {
    const node = nodesById.get(nodeId)
    const type = node?.type || 'image'
    ordinals[type] = (ordinals[type] ?? 0) + 1
    const content = (node?.type === 'text' || node?.type === 'style' ? node.content : node?.prompt)
      ?? node?.content
      ?? node?.prompt
      ?? ''
    return {
      id: nodeId,
      type,
      title: node?.title || nodeId,
      ordinal: ordinals[type],
      content,
    }
  })
}

/** Compile references for manual web generation when no model-specific prompt rules are available. */
export function compileManualPrompt(
  body: string,
  references: GenericPromptReference[],
): string {
  if (!body) return ''
  const curBody = body.trim()
  if (references.length === 0) return curBody

  const foundOccurrences: Array<{ start: number; end: number; replacement: string }> = []

  for (const ref of references) {
    const pfx = typePrefix[ref.type] || ''
    const patterns: Array<{ text: string; needBoundary: boolean }> = []
    if (ref.title) {
      if (pfx) {
        patterns.push({ text: `[${pfx}${ref.title}]`, needBoundary: false })
        patterns.push({ text: `${pfx}${ref.title}`, needBoundary: true })
      }
      patterns.push({ text: `[${ref.title}]`, needBoundary: false })
      if (pfx && ref.id) patterns.push({ text: `[${pfx}${ref.title}:${ref.id}]`, needBoundary: false })
    }
    if (ref.id) {
      patterns.push({ text: `[${ref.id}]`, needBoundary: false })
      patterns.push({ text: ref.id, needBoundary: true })
    }

    const content = (ref.content || '').trim()
    const replacement = ref.type === 'style' || ref.type === 'text'
      ? content || ref.title || ref.id
      : ref.type === 'image'
        ? `Image_${ref.ordinal}`
        : ref.type === 'video'
          ? `Video_${ref.ordinal}`
          : ref.type === 'audio'
            ? `Audio_${ref.ordinal}`
            : content || ref.title || ref.id

    for (const { text: pattern, needBoundary } of patterns) {
      let start = curBody.indexOf(pattern)
      while (start >= 0) {
        const end = start + pattern.length
        if (!needBoundary || (isBoundary(curBody[start - 1]) && isBoundary(curBody[end]))) {
          foundOccurrences.push({ start, end, replacement })
        }
        start = curBody.indexOf(pattern, end)
      }
    }
  }

  foundOccurrences.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start))
  const unique = foundOccurrences.filter((occurrence, index, all) => index === 0 || occurrence.start >= all[index - 1].end)
  let cursor = 0
  let output = ''
  for (const occurrence of unique) {
    output += curBody.slice(cursor, occurrence.start) + occurrence.replacement
    cursor = occurrence.end
  }
  output += curBody.slice(cursor)
  return output.trim()
}

function currentVersion(node: ProjectNode) {
  return node.history?.find((version) => version.current)
}

function findTreeChildren(tree: ProjectTreeItem[] | undefined, targetNodeId: string): string[] {
  if (!tree) return []
  const childIds: string[] = []
  function traverse(items: ProjectTreeItem[]): boolean {
    for (const item of items) {
      if (item.nodeId === targetNodeId) {
        if (item.children) {
          for (const child of item.children) {
            if (child.nodeId) childIds.push(child.nodeId)
          }
        }
        return true
      }
      if (item.children && traverse(item.children)) return true
    }
    return false
  }
  traverse(tree)
  return childIds
}

export function resolveGenerationReferences(
  prompt: string,
  nodes: Record<string, ProjectNode>,
  targetNodeId: string,
  tree?: ProjectTreeItem[],
) {
  const ordinals = { image: 0, video: 0, audio: 0, text: 0, style: 0 }
  const nodeMap = new Map(Object.values(nodes).map((node) => [node.id, node]))
  return orderedGenerationReferenceIds({
    prompt,
    nodes: Object.values(nodes),
    targetNodeId,
    structuralIds: findTreeChildren(tree, targetNodeId),
  }).flatMap<GenerationReference>((id, sourceIndex) => {
    const node = nodeMap.get(id)
    if (!node) return []
    ordinals[node.type] += 1
    return [{
      node,
      sourceIndex,
      ordinal: ordinals[node.type],
      currentVersion: currentVersion(node),
    }]
  })
}

export function nodePrompt(node: ProjectNode) {
  return (node.type === 'text' || node.type === 'style' ? node.content : node.prompt)?.trim() ?? ''
}

export function copyableGenerationReferences(references: GenerationReference[]) {
  return references.filter((reference) => (
    ['image', 'video', 'audio'].includes(reference.node.type) && reference.currentVersion
  ))
}

export function mediaDependencyVersionClipboardItems(
  dependencyIds: string[],
  nodes: Record<string, ProjectNode>,
) {
  const seen = new Set<string>()
  const nodesById = new Map(Object.values(nodes).map((node) => [node.id, node]))
  return dependencyIds.flatMap((nodeId) => {
    if (seen.has(nodeId)) return []
    seen.add(nodeId)
    const node = nodesById.get(nodeId)
    if (!node || !['image', 'video', 'audio'].includes(node.type)) return []
    const version = currentVersion(node)
    return version ? [{ nodeId, versionId: version.id }] : []
  })
}

/** Renderer guard: never turn an empty or partial backend result into visual success. */
export function assertGenerationExecutionResult(
  result: any,
  expectedNodeIds: readonly string[],
) {
  if (!result || result.status !== 'completed' || !Array.isArray(result.items)) {
    throw new Error(result?.message || '生成未返回完整完成结果')
  }
  if (result.items.length !== expectedNodeIds.length) {
    throw new Error(`生成结果数量不一致：请求 ${expectedNodeIds.length} 项，完成 ${result.items.length} 项`)
  }
  const actual = new Map<string, number>()
  for (const item of result.items) {
    if (item?.status !== 'downloaded' || typeof item.versionId !== 'string' || !item.versionId) {
      throw new Error(`生成结果未完成落盘：${item?.nodeId || 'unknown'}`)
    }
    actual.set(item.nodeId, (actual.get(item.nodeId) ?? 0) + 1)
  }
  for (const nodeId of expectedNodeIds) {
    const count = actual.get(nodeId) ?? 0
    if (count < 1) throw new Error(`生成结果缺少节点：${nodeId}`)
    actual.set(nodeId, count - 1)
  }
  return result
}
