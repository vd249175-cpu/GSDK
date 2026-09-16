import { nodeIdError } from './node-id.mjs'

const nodeTypeBySymbol = {
  '$': 'text',
  '@': 'image',
  '%': 'video',
  '~': 'audio',
  '&': 'style',
}

const idMapLine = /^\s*(?:['"]([^'"]+)['"]|([^:]+?))\s*:\s*\{\s*type\s*:\s*(['"]?)([$@%~&])\3\s*,\s*id\s*:\s*(['"]?)([^,'"}\s]+)\5\s*\}\s*$/
const nodeLine = /^(\s*)([$@%~&])\s*(.+?)\s*$/
const structureLine = /^(\s*)#+\s*(.+?)\s*$/
const structureOpenTag = '<project-structure>'
const structureCloseTag = '</project-structure>'

export function stripOutlineAnnotations(markdown) {
  if (typeof markdown !== 'string') return ''
  return markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
}

function usesTextPayload(type) {
  return type === 'text' || type === 'style'
}

function findStructureRange(lines, issues) {
  const openings = lines.flatMap((line, index) => line.trim() === structureOpenTag ? [index] : [])
  if (openings.length === 0) {
    issues.push({
      code: 'missing-structure',
      line: 1,
      severity: 'error',
      message: `缺少 ${structureOpenTag} 项目结构区域`,
    })
    return null
  }
  if (openings.length > 1) {
    issues.push({
      code: 'duplicate-structure',
      line: openings[1] + 1,
      severity: 'error',
      message: '一个项目只能包含一个项目结构区域',
    })
  }
  const start = openings[0]
  const end = lines.findIndex((line, index) => index > start && line.trim() === structureCloseTag)
  if (end < 0) {
    issues.push({
      code: 'unclosed-structure',
      line: start + 1,
      severity: 'error',
      message: `${structureOpenTag} 缺少结束标签 ${structureCloseTag}`,
    })
    return null
  }
  return { start: start + 1, end }
}

function parseIdMap(lines, issues) {
  const map = new Map()
  const ids = new Map()
  const frontmatterEnd = lines[0]?.trim() === '---'
    ? lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    : -1

  if (frontmatterEnd < 0) return { map, frontmatterEnd: -1 }

  for (let index = 1; index < frontmatterEnd; index += 1) {
    const match = lines[index].match(idMapLine)
    if (!match) continue
    const title = (match[1] ?? match[2]).trim()
    const entry = { symbol: match[4], id: match[6], line: index + 1 }
    const invalidId = nodeIdError(entry.id)
    if (invalidId) {
      issues.push({
        code: 'invalid-id',
        line: index + 1,
        severity: 'error',
        message: `${invalidId}：“${entry.id}”`,
      })
    }
    const existing = ids.get(entry.id)
    if (existing && existing.title !== title) {
      issues.push({
        code: 'duplicate-id',
        line: index + 1,
        severity: 'error',
        message: `ID “${entry.id}” 已由 “${existing.title}” 使用`,
      })
    }
    map.set(title, entry)
    ids.set(entry.id, { title, line: index + 1 })
  }
  return { map, frontmatterEnd }
}

function getRelation(parent) {
  if (!parent) return 'root'
  if (parent.kind === 'structure') return 'structure'
  return parent.nodeType === 'text' ? 'content' : 'dependency'
}

function countIndent(value) {
  return [...value].reduce((count, character) => count + (character === '\t' ? 2 : 1), 0)
}

export function parseProject(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const issues = []
  const { map } = parseIdMap(lines, issues)
  const structureRange = findStructureRange(lines, issues)
  if (!structureRange) return { tree: [], declarations: [], issues }
  const roots = []
  const stack = []
  const declarations = new Map()
  const occurrenceCount = new Map()
  let lastNodeDecl = null

  const structuredLines = lines.slice(structureRange.start, structureRange.end)
  const baseIndent = structuredLines.reduce((minimum, raw) => {
    const match = raw.match(nodeLine) ?? raw.match(structureLine)
    return match ? Math.min(minimum, countIndent(match[1])) : minimum
  }, Number.POSITIVE_INFINITY)
  const normalizedBaseIndent = Number.isFinite(baseIndent) ? baseIndent : 0

  for (let index = structureRange.start; index < structureRange.end; index += 1) {
    const raw = lines[index]
    const quoteMatch = raw.match(/^\s*>\s*(.+?)\s*$/)
    if (quoteMatch) {
      if (lastNodeDecl) {
        const text = quoteMatch[1].trim()
        lastNodeDecl.description = lastNodeDecl.description ? `${lastNodeDecl.description}\n${text}` : text
      }
      continue
    }

    const nodeMatch = raw.match(nodeLine)
    const structureMatch = raw.match(structureLine)
    if (!nodeMatch && !structureMatch) continue

    const indentation = Math.max(0, countIndent((nodeMatch ?? structureMatch)[1]) - normalizedBaseIndent)
    if (indentation % 2 !== 0) {
      issues.push({
        code: 'invalid-indent',
        line: index + 1,
        severity: 'error',
        message: '项目结构缩进必须使用两个空格为一级',
      })
    }
    const depth = Math.floor(indentation / 2)
    if (depth > stack.length) {
      issues.push({
        code: 'invalid-indent',
        line: index + 1,
        severity: 'error',
        message: '项目结构缩进不能跳过中间层级',
      })
    }
    while (stack.length > depth) stack.pop()
    const parent = stack[depth - 1]

    let item
    if (nodeMatch) {
      const symbol = nodeMatch[2]
      const title = nodeMatch[3].trim()
      const mapped = map.get(title)
      const id = mapped?.id ?? `auto:${symbol}:${title}`
      if (mapped && mapped.symbol !== symbol) {
        issues.push({
          code: 'type-mismatch',
          line: index + 1,
          severity: 'error',
          message: `“${title}” 正文前缀 ${symbol} 与映射 ${mapped.symbol} 不一致`,
        })
      }
      const count = occurrenceCount.get(id) ?? 0
      occurrenceCount.set(id, count + 1)
      item = {
        key: `${id}:${count}`,
        kind: 'node',
        title,
        depth,
        line: index + 1,
        relation: getRelation(parent),
        nodeId: id,
        nodeType: nodeTypeBySymbol[symbol],
        symbol,
        children: [],
      }
      if (!declarations.has(id)) {
        const type = nodeTypeBySymbol[symbol]
        const decl = {
          id,
          type,
          title,
          description: '',
          ...(usesTextPayload(type)
            ? { content: '', history: [] }
            : { prompt: '', history: [] }),
        }
        declarations.set(id, decl)
        lastNodeDecl = decl
      } else {
        lastNodeDecl = declarations.get(id)
      }
    } else {
      lastNodeDecl = null
      const title = structureMatch[2].trim()
      item = {
        key: `structure:${index}:${title}`,
        kind: 'structure',
        title,
        depth,
        line: index + 1,
        relation: getRelation(parent),
        children: [],
      }
    }

    if (parent) parent.children.push(item)
    else roots.push(item)
    stack[depth] = item
  }

  return { tree: roots, declarations: [...declarations.values()], issues }
}
