const beginMarker = '*** Begin Patch'
const endMarker = '*** End Patch'
const updateNodeHeader = /^\*\*\* Update Node:\s*(\S+)\s+(description|content|prompt)$/i
const updateStructureHeader = /^\*\*\* Update (Structure|Outline)(:\s*markdown)?$/i

function patchError(line, message) {
  throw new Error(`补丁第 ${line} 行${message}`)
}

function isHeaderLine(line) {
  return updateNodeHeader.test(line) || updateStructureHeader.test(line)
}

function parseHunk(lines, start) {
  const operations = []
  let index = start
  while (index < lines.length) {
    const line = lines[index]
    if (line === endMarker || line === '@@' || isHeaderLine(line)) break
    if (![' ', '+', '-'].includes(line[0])) patchError(index + 1, '必须以空格、+ 或 - 开头')
    operations.push({ kind: line[0], text: line.slice(1) })
    index += 1
  }
  if (operations.length === 0) patchError(start + 1, '缺少补丁内容')
  if (!operations.some((operation) => operation.kind !== ' ')) {
    patchError(start + 1, '没有增加或删除任何文本')
  }
  return { hunk: operations, next: index }
}

export function parseTextPatch(input) {
  const lines = input.replace(/\r\n/g, '\n').split('\n')
  while (lines.at(-1) === '') lines.pop()
  if (lines[0] !== beginMarker) throw new Error(`补丁必须以 ${beginMarker} 开始`)
  if (lines.at(-1) !== endMarker) throw new Error(`补丁必须以 ${endMarker} 结束`)
  const updates = []
  let index = 1
  while (index < lines.length - 1) {
    const structMatch = lines[index].match(updateStructureHeader)
    const nodeMatch = lines[index].match(updateNodeHeader)
    if (!structMatch && !nodeMatch) {
      patchError(index + 1, '需要 *** Update Node: <id> <field> 或 *** Update Structure')
    }
    const update = structMatch
      ? { type: 'structure', hunks: [] }
      : { type: 'node', id: nodeMatch[1], field: nodeMatch[2].toLowerCase(), hunks: [] }
    index += 1
    while (index < lines.length - 1 && !isHeaderLine(lines[index])) {
      if (lines[index] !== '@@') patchError(index + 1, '需要 @@ 开始文本块')
      const parsed = parseHunk(lines, index + 1)
      update.hunks.push(parsed.hunk)
      index = parsed.next
    }
    updates.push(update)
  }
  if (updates.length === 0) throw new Error('补丁没有 Update 区块')
  return updates
}

export function applyTargetReplace(sourceText, targetContent, replacementContent, label = '内容') {
  if (typeof targetContent !== 'string' || !targetContent) {
    throw new Error(`${label} 替换目标（targetContent）不能为空`)
  }
  const normSource = sourceText.replace(/\r\n/g, '\n')
  const normTarget = targetContent.replace(/\r\n/g, '\n')
  const normReplacement = (replacementContent ?? '').replace(/\r\n/g, '\n')

  const occurrences = normSource.split(normTarget).length - 1
  if (occurrences === 0) {
    throw new Error(`${label} 未找到要替换的目标文本（TargetContent）`)
  }
  if (occurrences > 1) {
    throw new Error(`${label} 匹配到 ${occurrences} 处相同的目标文本，请包含更多上下文以保持唯一性`)
  }
  return normSource.replace(normTarget, normReplacement)
}

function textLines(value) {
  const normalized = value.replace(/\r\n/g, '\n')
  const trailingNewline = normalized.endsWith('\n')
  const lines = normalized.split('\n')
  if (trailingNewline) lines.pop()
  if (lines.length === 1 && lines[0] === '') lines.pop()
  return { lines, trailingNewline }
}

function matchingOffsets(lines, expected) {
  if (expected.length === 0) return lines.length === 0 ? [0] : []
  const offsets = []
  for (let index = 0; index <= lines.length - expected.length; index += 1) {
    if (expected.every((line, offset) => lines[index + offset] === line)) offsets.push(index)
  }
  return offsets
}

export function applyTextHunks(value, hunks, label) {
  const parsed = textLines(value)
  let lines = parsed.lines
  for (const hunk of hunks) {
    const before = hunk.filter((operation) => operation.kind !== '+')
      .map((operation) => operation.text)
    const after = hunk.filter((operation) => operation.kind !== '-')
      .map((operation) => operation.text)
    const offsets = matchingOffsets(lines, before)
    if (offsets.length === 0) throw new Error(`${label} 的补丁上下文未匹配`)
    if (offsets.length > 1) throw new Error(`${label} 的补丁上下文匹配多处，请增加上下文行`)
    lines = [...lines.slice(0, offsets[0]), ...after, ...lines.slice(offsets[0] + before.length)]
  }
  if (lines.length === 0) return ''
  return `${lines.join('\n')}${parsed.trailingNewline ? '\n' : ''}`
}
