const symbolByType = Object.freeze({
  text: '$',
  image: '@',
  video: '%',
  audio: '~',
  style: '&',
})

export const queryFieldByCode = Object.freeze({
  i: 'id',
  t: 'type',
  n: 'title',
  d: 'description',
  c: 'content',
  p: 'prompt',
  m: 'model',
  g: 'generationConfig',
  h: 'history',
  v: 'currentVersion',
})

const queryFieldAliases = Object.freeze({
  ...queryFieldByCode,
  id: 'id',
  type: 'type',
  name: 'title',
  title: 'title',
  description: 'description',
  content: 'content',
  prompt: 'prompt',
  model: 'model',
  config: 'generationConfig',
  generationconfig: 'generationConfig',
  history: 'history',
  current: 'currentVersion',
  currentversion: 'currentVersion',
})

const codeByQueryField = Object.freeze(Object.fromEntries(
  Object.entries(queryFieldByCode).map(([code, field]) => [field, code]),
))
const longTextFields = new Set(['description', 'content', 'prompt'])

export function parseSelector(raw, line = 1) {
  let source = String(raw ?? '').trim()
  if (!source) throw new Error(`查询第 ${line} 行包含空节点`)
  const originalTrimmed = source
  if (source.startsWith('[') && source.endsWith(']')) {
    source = source.slice(1, -1).trim()
  }

  // 1. Recursive wildcard (/**)
  if (source.includes('/**')) {
    const [scopePart, after] = source.split('/**')
    const scopePath = scopePart.trim() || null
    let targetSymbol = null
    const targetTrimmed = (after || '').replace(/^\//, '').trim()
    if (targetTrimmed) {
      const sym = targetTrimmed[0]
      if ('$@%~&'.includes(sym)) targetSymbol = sym
    }
    return {
      raw: originalTrimmed,
      isWildcard: true,
      recursive: true,
      scopePath,
      targetSymbol,
    }
  }

  // 2. Direct child wildcard (/* or /@ or /% or /~ or /& or /$)
  const directChildMatch = source.match(/^(.*?)\/([*@%~&$])\*?$/)
  if (directChildMatch) {
    const scopePath = directChildMatch[1].trim()
    const sym = directChildMatch[2]
    const targetSymbol = sym === '*' ? null : sym
    return {
      raw: originalTrimmed,
      isWildcard: true,
      recursive: false,
      scopePath: scopePath || null,
      targetSymbol,
    }
  }

  // 3. Global single-character or star wildcard
  if (source === '*' || source === '**') {
    return { raw: originalTrimmed, isWildcard: true, recursive: true, scopePath: null, targetSymbol: null }
  }
  if (/^([@%~&$])\*?$/.test(source)) {
    return { raw: originalTrimmed, isWildcard: true, recursive: true, scopePath: null, targetSymbol: source[0] }
  }

  // 4. Standard explicit selector
  const symbol = '$@%~&'.includes(source[0]) ? source[0] : null
  const leafTitle = symbol ? source.slice(symbol.length).trim() : source
  return { raw: originalTrimmed, isWildcard: false, symbol, title: leafTitle }
}

function parseFields(raw, line) {
  const source = raw.trim().toLowerCase()
  if (!source) throw new Error(`查询第 ${line} 行缺少字段`)
  const tokens = /^[itndcpmghv]+$/.test(source) ? [...source] : source.split(/[\s,]+/).filter(Boolean)
  const fields = tokens.map((token) => queryFieldAliases[token])
  const invalid = tokens.filter((_, index) => !fields[index])
  if (invalid.length) throw new Error(`查询第 ${line} 行包含未知字段：${invalid.join(', ')}`)
  return [...new Set(fields)]
}

export function parseQueryLanguage(input) {
  const lines = (input ?? '').replace(/\r\n/g, '\n').split('\n')
  const requests = []
  lines.forEach((raw, index) => {
    const source = raw.trim()
    if (!source || source.startsWith('//')) return
    const separator = source.indexOf('::')
    if (separator < 0) {
      throw new Error(`查询第 ${index + 1} 行缺少 "::" 字段指示符。格式: <节点选择器> :: <字段代码(d,c,p,m,g,h,v)>，例如: '[@主角] :: p' 或 '$第一幕/% :: p,m'`)
    }
    const selectorSource = source.slice(0, separator).trim()
    const fieldSource = source.slice(separator + 2).trim()
    if (selectorSource.includes(';')) throw new Error(`查询第 ${index + 1} 行只支持逗号分隔节点`)
    const selectors = selectorSource.split(',').map((part) => parseSelector(part.trim(), index + 1))
    requests.push({ line: index + 1, selectors, fields: parseFields(fieldSource, index + 1) })
  })
  if (requests.length === 0) {
    throw new Error("query 需要指定查询语句，例如: graphvideo query '[@主角] :: dcp'。如需查看全局大纲树，请使用 graphvideo structure")
  }
  return requests
}

function issueLine(issue) {
  return `! ${issue.code}@${issue.line} ${issue.message}`
}

function nodeLabel(node) {
  return `${symbolByType[node.type] ?? '?'}${node.title}`
}

export function overviewStatuses(fields) {
  const statuses = [
    ['d', fields.descriptionEmpty],
    ...(Object.hasOwn(fields, 'contentEmpty') ? [['c', fields.contentEmpty]] : []),
    ...(Object.hasOwn(fields, 'promptEmpty') ? [['p', fields.promptEmpty]] : []),
    ...(Object.hasOwn(fields, 'modelEmpty') ? [['m', fields.modelEmpty]] : []),
    ['h', fields.historyEmpty],
    ['v', fields.currentVersionEmpty],
  ]
  return statuses.map(([code, empty]) => `${code}${empty ? '-' : '+'}`).join(' ')
}

function overviewLines(items, depth = 0) {
  return items.flatMap((item) => {
    const prefix = '  '.repeat(depth)
    const line = item.kind === 'structure'
      ? `${prefix}# ${item.title}`
      : `${prefix}${nodeLabel(item)} {i=${item.id} ${overviewStatuses(item.fields)}}`
    return [line, ...overviewLines(item.children, depth + 1)]
  })
}

export function formatProjectOverview(overview) {
  const lines = overviewLines(overview.tree)
  if (overview.issues.length) lines.push(...overview.issues.map(issueLine))
  return lines.join('\n')
}

function hasValue(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function fieldLines(field, value) {
  const code = codeByQueryField[field]
  const state = hasValue(value)
  if (state === null) return [`  ${code}?`]
  if (!state) return [`  ${code}-`]
  if (!longTextFields.has(field) || typeof value !== 'string') {
    return [`  ${code}+ ${JSON.stringify(value)}`]
  }
  const rows = value.replace(/\r\n/g, '\n').split('\n')
  if (value.endsWith('\n')) rows.pop()
  return [
    `  ${code}+ |`,
    ...rows.map((row) => `    ${row}`),
  ]
}

export function formatProjectQuery(query) {
  return query.lines.flatMap((line) => line.selectors.flatMap((selector) => {
    if (selector.matches.length === 0) return [`? ${selector.raw}`]
    return selector.matches.flatMap((match) => [
      `${nodeLabel(match)} {i=${match.id}}`,
      ...line.fields.flatMap((field) => fieldLines(field, match.fields[field])),
    ])
  })).join('\n')
}

export function formatProjectRename(result) {
  const sym = symbolByType[result.node.type] ?? ''
  let output = `= renamed [${sym}${result.node.oldTitle}] -> [${sym}${result.node.newTitle}]`
  if (result.affectedReferencesCount > 0) {
    output += ` (updated ${result.affectedReferencesCount} references across other nodes)`
  } else {
    output += ` (0 external references updated)`
  }
  return output
}

function formatIssues(issues) {
  if (!issues || issues.length === 0) return []
  const conflicts = issues.filter((i) => i.code === 'historical-name-conflict')
  const others = issues.filter((i) => i.code !== 'historical-name-conflict')
  const lines = []
  if (conflicts.length > 0) {
    const tuples = conflicts.map((c) => [c.title ?? c.message.replace(/^[!@%~&$[\]\s]+/, '').split(' ')[0]])
    lines.push(`! conflict ${JSON.stringify(tuples)}`)
  }
  if (others.length > 0) {
    lines.push(...others.map(issueLine))
  }
  return lines
}

export function formatProjectStructure(structure) {
  if (structure.lines && Array.isArray(structure.lines)) {
    const output = [...structure.lines]
    output.push(...formatIssues(structure.issues))
    return output.join('\n')
  }
  const lines = [structure.markdown]
  lines.push(...formatIssues(structure.issues))
  return lines.join('\n')
}

export function formatProjectRun(result) {
  const lines = [result.applied
    ? `= run nodes=${result.nodeCount} retained=${result.retainedNodeCount}`
    : `! run nodes=${result.nodeCount}`]
  lines.push(...formatIssues(result.issues))
  return lines.join('\n')
}

export function formatProjectEdit(result, action = 'edit') {
  const lines = []
  if (result.structureResult) {
    lines.push(result.structureResult.applied
      ? `= structure nodes=${result.structureResult.nodeCount} retained=${result.structureResult.retainedNodeCount}`
      : `! structure nodes=${result.structureResult.nodeCount}`)
    lines.push(...formatIssues(result.structureResult.issues))
  }
  if (result.updated?.length) {
    lines.push(`= ${action} nodes=${result.updated.length}`)
    lines.push(...result.updated.map((node) => (
      `${nodeLabel(node)} {i=${node.id} ${overviewStatuses(node.fields)}}`
    )))
  } else if (!result.structureResult) {
    lines.push(`= ${action} nodes=0`)
  }
  return lines.join('\n')
}

export function formatProjectHistory(history) {
  if (!history.retained || history.retained.length === 0) {
    return '= 历史保留资产库 (0 个节点)'
  }
  const lines = [`= 历史保留资产库 (${history.retained.length} 个节点)`]
  history.retained.forEach((node) => {
    lines.push(`  [${node.symbol}${node.title}] {i=${node.id} versions=${node.historyCount} hasMedia=${node.hasMedia}}`)
  })
  return lines.join('\n')
}
