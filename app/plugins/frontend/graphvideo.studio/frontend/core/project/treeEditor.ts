import { parseProject } from './parser'
import {
  type NodeType, type NodeSymbol, type ParsedProject, type ProjectTreeItem,
} from './types'

const symbolByNodeType: Record<NodeType, NodeSymbol> = {
  text: '$', image: '@', video: '%', audio: '~', style: '&',
}

const structureOpenTag = '<project-structure>'
const structureCloseTag = '</project-structure>'
const mappingLine = /^\s*(?:['"]([^'"]+)['"]|([^:]+?))\s*:\s*\{\s*type\s*:\s*(['"]?)([$@%~&])\3\s*,\s*id\s*:\s*(['"]?)([^,'"}\s]+)\5\s*\}\s*$/

export type ProjectTreeDropPosition = 'before' | 'after'

export interface ProjectTreeClipboardLine {
  kind: ProjectTreeItem['kind']
  title: string
  relativeDepth: number
  nodeId?: string
}

export interface ProjectTreeClipboardItem {
  lines: ProjectTreeClipboardLine[]
}

export type ProjectTreeEditOperation =
  | {
    type: 'create'
    parentKey: string | null
    kind: 'structure'
    title: string
  }
  | {
    type: 'create'
    parentKey: string | null
    kind: 'node'
    title: string
    nodeType: NodeType
    nodeId: string
  }
  | { type: 'rename'; key: string; title: string }
  | { type: 'delete'; key: string }
  | {
    type: 'move'
    key: string
    targetKey: string | null
    position: ProjectTreeDropPosition
  }
  | {
    type: 'adjust-depth'
    key: string
    direction: 'left' | 'right'
    includeChildren: boolean
  }
  | {
    type: 'paste'
    targetKey: string | null
    item: ProjectTreeClipboardItem
  }

export interface ProjectTreeEditResult {
  markdown: string
  parsed: ParsedProject
  preferredNodeId: string | null
}

interface MarkdownDocument {
  eol: '\n' | '\r\n'
  lines: string[]
  trailingNewline: boolean
}

function readDocument(markdown: string): MarkdownDocument {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  return {
    eol,
    lines: markdown.replace(/\r\n/g, '\n').split('\n'),
    trailingNewline: markdown.endsWith('\n'),
  }
}

function writeDocument(document: MarkdownDocument) {
  let value = document.lines.join(document.eol)
  if (!document.trailingNewline && value.endsWith(document.eol)) {
    value = value.slice(0, -document.eol.length)
  }
  return value
}

export function flattenProjectTree(tree: ProjectTreeItem[]): ProjectTreeItem[] {
  return tree.flatMap((item) => [item, ...flattenProjectTree(item.children)])
}

export function copyProjectTreeItem(
  tree: ProjectTreeItem[],
  key: string,
): ProjectTreeClipboardItem {
  const item = flattenProjectTree(tree).find((entry) => entry.key === key)
  if (!item) throw new Error('找不到要复制的项目项')
  return {
    lines: flattenProjectTree([item]).map((entry) => ({
      kind: entry.kind,
      title: entry.title,
      relativeDepth: entry.depth - item.depth,
      ...(entry.nodeId ? { nodeId: entry.nodeId } : {}),
    })),
  }
}

function findItem(parsed: ParsedProject, key: string) {
  const item = flattenProjectTree(parsed.tree).find((entry) => entry.key === key)
  if (!item) throw new Error('项目目录已变化，请重试')
  return item
}

interface ItemLocation {
  item: ProjectTreeItem
  parent: ProjectTreeItem | null
  siblings: ProjectTreeItem[]
  index: number
}

function findLocation(
  tree: ProjectTreeItem[],
  key: string,
  parent: ProjectTreeItem | null = null,
): ItemLocation | null {
  for (let index = 0; index < tree.length; index += 1) {
    const item = tree[index]
    if (item.key === key) return { item, parent, siblings: tree, index }
    const nested = findLocation(item.children, key, item)
    if (nested) return nested
  }
  return null
}

function normalizedTitle(value: string) {
  const title = value.trim()
  if (!title) throw new Error('名称不能为空')
  if (/[\r\n]/.test(title)) throw new Error('名称不能换行')
  if (/['"]/.test(title)) throw new Error('名称暂不支持引号')
  return title
}

function assertValidProject(parsed: ParsedProject) {
  const issue = parsed.issues.find((entry) => entry.severity === 'error')
  if (issue) throw new Error(issue.message)
}

function structureBounds(lines: string[]) {
  const opening = lines.findIndex((line) => line.trim() === structureOpenTag)
  const closing = lines.findIndex((line, index) => (
    index > opening && line.trim() === structureCloseTag
  ))
  if (opening < 0 || closing < 0) throw new Error('项目结构区域不可用')
  return { opening, closing }
}

function itemBlock(parsed: ParsedProject, item: ProjectTreeItem, closing: number) {
  const start = item.line - 1
  const next = flattenProjectTree(parsed.tree).find((candidate) => (
    candidate.line > item.line && candidate.depth <= item.depth
  ))
  return { start, end: next ? next.line - 1 : closing }
}

function baseIndent(parsed: ParsedProject, lines: string[]) {
  const first = flattenProjectTree(parsed.tree)[0]
  return first ? lines[first.line - 1].match(/^\s*/)?.[0].length ?? 0 : 0
}

function renderTitleLine(item: ProjectTreeItem, title: string, lines: string[]) {
  const indentation = lines[item.line - 1].match(/^\s*/)?.[0] ?? ''
  return item.kind === 'node'
    ? `${indentation}${item.symbol}${title}`
    : `${indentation}# ${title}`
}

function assertUniqueNodeTitle(parsed: ParsedProject, title: string, ignoredNodeId?: string) {
  const conflict = parsed.declarations.find((node) => node.title === title && node.id !== ignoredNodeId)
  if (conflict) throw new Error(`节点名称“${title}”已被使用`)
}

function complete(document: MarkdownDocument, preferredNodeId: string | null): ProjectTreeEditResult {
  const markdown = writeDocument(document)
  const parsed = parseProject(markdown)
  assertValidProject(parsed)
  return { markdown, parsed, preferredNodeId }
}

function createItem(
  document: MarkdownDocument,
  parsed: ParsedProject,
  operation: Extract<ProjectTreeEditOperation, { type: 'create' }>,
) {
  const title = normalizedTitle(operation.title)
  if (operation.kind === 'node') {
    assertUniqueNodeTitle(parsed, title)
  }
  const { closing } = structureBounds(document.lines)
  const parent = operation.parentKey ? findItem(parsed, operation.parentKey) : null
  const parentBlock = parent ? itemBlock(parsed, parent, closing) : null
  const depth = parent ? parent.depth + 1 : 0
  const indentation = ' '.repeat(baseIndent(parsed, document.lines) + depth * 2)
  const symbol = operation.kind === 'node' ? symbolByNodeType[operation.nodeType] : null
  const line = operation.kind === 'node'
    ? `${indentation}${symbol}${title}`
    : `${indentation}#${title}`
  document.lines.splice(parentBlock?.end ?? closing, 0, line)
  return complete(document, null)
}

function renameItem(
  document: MarkdownDocument,
  parsed: ParsedProject,
  operation: Extract<ProjectTreeEditOperation, { type: 'rename' }>,
) {
  const item = findItem(parsed, operation.key)
  const title = normalizedTitle(operation.title)
  if (item.title === title) return complete(document, item.nodeId ?? null)
  if (item.kind === 'node') {
    assertUniqueNodeTitle(parsed, title, item.nodeId)
    flattenProjectTree(parsed.tree)
      .filter((entry) => (item.nodeId && entry.nodeId === item.nodeId) || entry.title === item.title)
      .forEach((entry) => { document.lines[entry.line - 1] = renderTitleLine(entry, title, document.lines) })
  } else {
    document.lines[item.line - 1] = renderTitleLine(item, title, document.lines)
  }
  return complete(document, item.nodeId ?? null)
}

function deleteItem(
  document: MarkdownDocument,
  parsed: ParsedProject,
  operation: Extract<ProjectTreeEditOperation, { type: 'delete' }>,
) {
  const item = findItem(parsed, operation.key)
  const { closing } = structureBounds(document.lines)
  const block = itemBlock(parsed, item, closing)
  document.lines.splice(block.start, block.end - block.start)
  return complete(document, null)
}

function reindentBlock(lines: string[], sourceIndent: number, targetIndent: number) {
  const sourcePrefix = ' '.repeat(sourceIndent)
  const targetPrefix = ' '.repeat(targetIndent)
  return lines.map((line) => {
    if (!line.trim()) return line
    return `${targetPrefix}${line.startsWith(sourcePrefix) ? line.slice(sourceIndent) : line.trimStart()}`
  })
}

function moveItem(
  document: MarkdownDocument,
  parsed: ParsedProject,
  operation: Extract<ProjectTreeEditOperation, { type: 'move' }>,
) {
  const source = findItem(parsed, operation.key)
  const target = operation.targetKey ? findItem(parsed, operation.targetKey) : null
  const { closing } = structureBounds(document.lines)
  const sourceBlock = itemBlock(parsed, source, closing)
  if (target) {
    const targetBlock = itemBlock(parsed, target, closing)
    if (targetBlock.start >= sourceBlock.start && targetBlock.start < sourceBlock.end) {
      throw new Error('不能把项目项移动到自身内部')
    }
  }
  const targetBlock = target ? itemBlock(parsed, target, closing) : null
  const insertion = !targetBlock
    ? closing
    : operation.position === 'before' ? targetBlock.start : targetBlock.end
  const sourceLines = document.lines.slice(sourceBlock.start, sourceBlock.end)
  document.lines.splice(sourceBlock.start, sourceLines.length)
  const adjustedInsertion = insertion > sourceBlock.start ? insertion - sourceLines.length : insertion
  document.lines.splice(adjustedInsertion, 0, ...sourceLines)
  return complete(document, source.nodeId ?? null)
}

function shiftBlockDepth(
  document: MarkdownDocument,
  parsed: ParsedProject,
  source: ProjectTreeItem,
  target: ProjectTreeItem,
  position: 'inside' | 'after',
) {
  const { closing } = structureBounds(document.lines)
  const sourceBlock = itemBlock(parsed, source, closing)
  const targetBlock = itemBlock(parsed, target, closing)
  const insertion = targetBlock.end
  const indentation = baseIndent(parsed, document.lines)
  const sourceLines = document.lines.slice(sourceBlock.start, sourceBlock.end)
  document.lines.splice(sourceBlock.start, sourceLines.length)
  const adjustedInsertion = insertion > sourceBlock.start ? insertion - sourceLines.length : insertion
  const targetDepth = position === 'inside' ? target.depth + 1 : target.depth
  document.lines.splice(adjustedInsertion, 0, ...reindentBlock(
    sourceLines,
    indentation + source.depth * 2,
    indentation + targetDepth * 2,
  ))
}

function adjustSingleLeft(
  document: MarkdownDocument,
  parsed: ParsedProject,
  source: ProjectTreeItem,
  parent: ProjectTreeItem,
) {
  const { closing } = structureBounds(document.lines)
  const sourceBlock = itemBlock(parsed, source, closing)
  const parentBlock = itemBlock(parsed, parent, closing)
  const indentation = baseIndent(parsed, document.lines)
  const sourceIndent = indentation + source.depth * 2
  const line = reindentBlock(
    [document.lines[sourceBlock.start]], sourceIndent, sourceIndent - 2,
  )[0]
  const descendants = document.lines.slice(sourceBlock.start + 1, sourceBlock.end)
  const promotedDescendants = reindentBlock(descendants, sourceIndent + 2, sourceIndent)
  document.lines.splice(
    sourceBlock.start,
    sourceBlock.end - sourceBlock.start,
    ...promotedDescendants,
  )
  const insertion = parentBlock.end - 1
  document.lines.splice(insertion, 0, line)
}

function adjustDepth(
  document: MarkdownDocument,
  parsed: ParsedProject,
  operation: Extract<ProjectTreeEditOperation, { type: 'adjust-depth' }>,
) {
  const location = findLocation(parsed.tree, operation.key)
  if (!location) throw new Error('项目目录已变化，请重试')
  const { item: source, parent, siblings, index } = location
  if (operation.direction === 'right') {
    const previousSibling = siblings[index - 1]
    if (!previousSibling) throw new Error('当前项前面没有可作为父级的同层项目项')
    if (operation.includeChildren) {
      shiftBlockDepth(document, parsed, source, previousSibling, 'inside')
    } else {
      const indentation = document.lines[source.line - 1].match(/^\s*/)?.[0] ?? ''
      document.lines[source.line - 1] = `  ${indentation}${document.lines[source.line - 1].slice(indentation.length)}`
    }
  } else {
    if (!parent) throw new Error('当前项已经位于最左层级')
    if (operation.includeChildren) shiftBlockDepth(document, parsed, source, parent, 'after')
    else adjustSingleLeft(document, parsed, source, parent)
  }
  return complete(document, source.nodeId ?? null)
}

function pasteItem(
  document: MarkdownDocument,
  parsed: ParsedProject,
  operation: Extract<ProjectTreeEditOperation, { type: 'paste' }>,
) {
  const [root, ...remaining] = operation.item.lines
  if (!root || root.relativeDepth !== 0 || operation.item.lines.some((line) => (
    line.relativeDepth < 0 || !Number.isInteger(line.relativeDepth)
  ))) throw new Error('复制的项目内容无效')
  let previousDepth = 0
  remaining.forEach((line) => {
    if (line.relativeDepth > previousDepth + 1) throw new Error('复制的项目层级无效')
    previousDepth = line.relativeDepth
  })

  const declarations = new Map(parsed.declarations.map((node) => [node.id, node]))
  operation.item.lines.forEach((line) => {
    if (line.kind === 'node' && (!line.nodeId || !declarations.has(line.nodeId))) {
      throw new Error('复制内容引用的节点已不在当前项目中')
    }
  })
  const { closing } = structureBounds(document.lines)
  const target = operation.targetKey ? findItem(parsed, operation.targetKey) : null
  const targetBlock = target ? itemBlock(parsed, target, closing) : null
  const insertion = targetBlock?.end ?? closing
  const rootDepth = target?.depth ?? 0
  const indentation = baseIndent(parsed, document.lines)
  const lines = operation.item.lines.map((line) => {
    const prefix = ' '.repeat(indentation + (rootDepth + line.relativeDepth) * 2)
    if (line.kind === 'structure') return `${prefix}#${line.title}`
    const declaration = declarations.get(line.nodeId!)!
    return `${prefix}${symbolByNodeType[declaration.type]}${declaration.title}`
  })
  document.lines.splice(insertion, 0, ...lines)
  return complete(document, root.nodeId ?? null)
}

export function editProjectTree(
  markdown: string,
  operation: ProjectTreeEditOperation,
): ProjectTreeEditResult {
  const parsed = parseProject(markdown)
  assertValidProject(parsed)
  const document = readDocument(markdown)
  if (operation.type === 'create') return createItem(document, parsed, operation)
  if (operation.type === 'rename') return renameItem(document, parsed, operation)
  if (operation.type === 'delete') return deleteItem(document, parsed, operation)
  if (operation.type === 'move') return moveItem(document, parsed, operation)
  if (operation.type === 'adjust-depth') return adjustDepth(document, parsed, operation)
  return pasteItem(document, parsed, operation)
}
