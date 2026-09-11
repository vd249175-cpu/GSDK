import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseProject, stripOutlineAnnotations } from '../shared/project-parser.mjs'
import { parseGenerationPrompt } from '../shared/generation-prompt.mjs'
import {
  openLocalProject, renameRetainedNode, saveProjectMarkdown, saveProjectNode, saveProjectSnapshot,
} from '../../electron/project-store.mjs'
import {
  deleteGenerationModel,
  importGenerationModel,
  listGenerationModels,
  readGenerationModel,
} from '../../electron/generation-model-store.mjs'
import { applyTextHunks, applyTargetReplace } from './text-patch.mjs'
import { parseSelector, overviewStatuses } from './symbol-language.mjs'

export const editableNodeFields = Object.freeze(['description', 'content', 'prompt'])
const textTypes = new Set(['text', 'style'])
export const typeBySymbol = Object.freeze({ $: 'text', '@': 'image', '%': 'video', '~': 'audio', '&': 'style' })
export const symbolByType = Object.freeze({ text: '$', image: '@', video: '%', audio: '~', style: '&' })

function escapeRegex(string) {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function nodeRecord(nodes) {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

function isBlank(value) {
  return typeof value !== 'string' || value.trim().length === 0
}

function fieldStatus(node) {
  const text = textTypes.has(node.type)
  const history = node.history ?? []
  return {
    descriptionEmpty: isBlank(node.description),
    ...(text ? { contentEmpty: isBlank(node.content) } : {
      promptEmpty: isBlank(node.prompt),
      modelEmpty: !generationPromptInfo(node.prompt).model,
    }),
    historyEmpty: history.length === 0,
    currentVersionEmpty: !history.some((version) => version.current),
  }
}

function generationPromptInfo(prompt) {
  try {
    const parsed = parseGenerationPrompt(prompt ?? '')
    return { model: parsed.modelId, config: parsed.config, error: null }
  } catch (error) {
    return {
      model: null,
      config: null,
      error: error instanceof Error ? error.message : '提示词 YAML 无效',
    }
  }
}

function overviewItem(item, nodes, parentPath = '') {
  const node = item.nodeId ? (nodes[item.nodeId] ?? Object.values(nodes).find((n) => n.type === item.nodeType && n.title === item.title)) : null
  const sym = item.kind === 'structure' ? '#' : (item.symbol ?? '')
  const currentPath = parentPath ? `${parentPath}/${sym}${item.title}` : `${sym}${item.title}`
  return {
    key: item.key,
    kind: item.kind,
    title: item.title,
    depth: item.depth,
    relation: item.relation,
    path: currentPath,
    ...(node ? {
      id: node.id,
      type: node.type,
      fullPath: currentPath,
      fields: fieldStatus(node),
    } : {}),
    children: item.children.map((child) => overviewItem(child, nodes, currentPath)),
  }
}

function flattenTreeNodes(items, parentPath = '') {
  const result = []
  for (const item of items) {
    const sym = item.kind === 'structure' ? '#' : (item.symbol ?? '')
    const currentPath = parentPath ? `${parentPath}/${sym}${item.title}` : `${sym}${item.title}`
    if (item.nodeId) {
      result.push({
        id: item.nodeId,
        fullPath: currentPath,
        scopePath: parentPath,
        title: item.title,
        type: item.nodeType,
      })
    }
    if (item.children?.length) {
      result.push(...flattenTreeNodes(item.children, currentPath))
    }
  }
  return result
}

function synchronizeTreeItemIds(items, declMap) {
  for (const item of items) {
    if (item.nodeId && declMap.has(item.nodeId)) {
      item.nodeId = declMap.get(item.nodeId)
    } else if (item.kind === 'node') {
      const mapped = declMap.get(`${item.nodeType}:${item.title}`)
      if (mapped) item.nodeId = mapped
    }
    if (item.children?.length) {
      synchronizeTreeItemIds(item.children, declMap)
    }
  }
}

function mergeProjectNodes(parsed, activeNodes, retainedNodes, issues = []) {
  const activeById = nodeRecord(activeNodes)
  const retainedById = nodeRecord(retainedNodes)
  const activeByTypeTitle = new Map(activeNodes.map((n) => [`${n.type}:${n.title}`, n]))
  const retainedByTypeTitle = new Map(retainedNodes.map((n) => [`${n.type}:${n.title}`, n]))

  const declMap = new Map()
  const result = {}
  const seenConflicts = new Set()

  for (const decl of parsed.declarations) {
    const oldId = decl.id
    const isAutoId = !decl.id || decl.id.startsWith('auto:') || decl.id.startsWith('unmapped:')
    let resolvedNode = null

    if (isAutoId) {
      const activeMatch = activeByTypeTitle.get(`${decl.type}:${decl.title}`)
      if (activeMatch) {
        // 场景一：名称未变，连续活跃节点，直接延续
        resolvedNode = {
          ...activeMatch,
          type: decl.type,
          title: decl.title,
          ...(decl.description ? { description: decl.description } : {}),
        }
      } else {
        const retainedMatch = retainedByTypeTitle.get(`${decl.type}:${decl.title}`)
        const hasAssets = retainedMatch && (
          (retainedMatch.history ?? []).length > 0
          || (retainedMatch.prompt ?? '').trim().length > 0
          || (retainedMatch.content ?? '').trim().length > 0
        )

        if (hasAssets && !decl.reused) {
          // 场景三：历史重名撞车，触发意图判断拦截
          const sym = decl.symbol ?? (symbolByType[decl.type] ?? '')
          const conflictKey = `${decl.type}:${decl.title}`
          if (!seenConflicts.has(conflictKey)) {
            seenConflicts.add(conflictKey)
            issues.push({
              code: 'historical-name-conflict',
              line: 1,
              severity: 'error',
              title: decl.title,
              symbol: sym,
              message: `[${sym}${decl.title}] 命中历史保留资产`,
            })
          }
          resolvedNode = {
            ...retainedMatch,
            type: decl.type,
            title: decl.title,
            ...(decl.description ? { description: decl.description } : {}),
          }
        } else if (retainedMatch && decl.reused) {
          // 场景三 (选项 3): 显式确认继承复用历史资产
          resolvedNode = {
            ...retainedMatch,
            type: decl.type,
            title: decl.title,
            ...(decl.description ? { description: decl.description } : {}),
          }
        } else {
          // 场景二：全新节点（分配新 ID）
          const newId = `node_${randomUUID().slice(0, 8).replace(/-/g, '_')}`
          resolvedNode = { ...decl, id: newId }
        }
      }
    } else {
      const previous = activeById[decl.id] ?? retainedById[decl.id]
      if (previous && previous.active === 0 && (previous.type !== decl.type || previous.title !== decl.title)) {
        issues.push({
          code: 'retained-id-conflict',
          line: 1,
          severity: 'error',
          message: `ID “${decl.id}” 已由保留节点 “${previous.title}” 占用`,
        })
      }
      resolvedNode = previous
        ? { ...previous, type: decl.type, title: decl.title, ...(decl.description ? { description: decl.description } : {}) }
        : decl
    }
    declMap.set(oldId, resolvedNode.id)
    declMap.set(`${decl.type}:${decl.title}`, resolvedNode.id)
    decl.id = resolvedNode.id
    result[resolvedNode.id] = resolvedNode
  }
  if (parsed.tree) {
    synchronizeTreeItemIds(parsed.tree, declMap)
  }
  return result
}

export async function assertProjectRoot(projectRoot) {
  const root = resolve(projectRoot)
  const dbFile = join(root, '.graphvideo', 'nodes.sqlite')
  try {
    if ((await stat(dbFile)).isFile()) {
      await openLocalProject(root)
      return root
    }
  } catch {}
  try {
    await openLocalProject(root)
    return root
  } catch {}
  throw new Error('项目目录无法初始化或缺少数据库')
}

export async function signalProjectChanged(projectRoot, source) {
  const directory = join(projectRoot, '.graphvideo')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'external-update.json'), JSON.stringify({
    id: randomUUID(), source, updatedAt: new Date().toISOString(),
  }), 'utf8')
}

export async function runMarkdownLogic(projectRoot) {
  const root = await assertProjectRoot(projectRoot)
  const project = await openLocalProject(root)
  const markdown = project.markdown ?? ''
  const parsed = parseProject(markdown)
  const issues = [...parsed.issues]
  const nodes = mergeProjectNodes(parsed, project.nodes, project.retainedNodes, issues)

  if (issues.some((issue) => issue.severity === 'error')) {
    return { applied: false, issues, nodeCount: project.nodes.length }
  }
  const saved = await saveProjectSnapshot(root, { markdown, nodes: Object.values(nodes) })
  await signalProjectChanged(root, 'markdown_logic_run')
  return {
    applied: true,
    issues,
    nodeCount: saved.nodes.length,
    retainedNodeCount: saved.retainedNodes.length,
  }
}

export async function getProjectStructure(projectRoot, scope = null, depth = 1, includeStatus = false) {
  const root = await assertProjectRoot(projectRoot)
  const project = await openLocalProject(root)
  const markdown = project.markdown ?? ''
  const parsed = parseProject(markdown)
  const issues = [...parsed.issues]
  const nodes = mergeProjectNodes(parsed, project.nodes, project.retainedNodes, issues)

  let maxDepth = 1
  if (depth === 'all' || depth === 0 || depth === -1 || depth === '0') {
    maxDepth = Number.POSITIVE_INFINITY
  } else if (depth !== undefined && depth !== null) {
    const parsedDepth = parseInt(depth, 10)
    if (!Number.isNaN(parsedDepth) && parsedDepth >= 0) {
      maxDepth = parsedDepth === 0 ? Number.POSITIVE_INFINITY : parsedDepth
    }
  }

  let targetItems = parsed.tree
  let baseScopeItem = null
  if (scope && scope !== 'all') {
    const rawSegments = scope.split('/').map((s) => s.trim()).filter(Boolean)
    const normalizedSegments = rawSegments.map((s) => ({
      raw: s,
      symbol: '$@%~&#'.includes(s[0]) ? s[0] : null,
      title: s.replace(/^[#$@%~&\s]+/, '').trim(),
    }))

    function matchItem(item, segment) {
      if (segment.symbol) {
        const itemSym = item.kind === 'structure' ? '#' : (item.symbol ?? symbolByType[item.nodeType] ?? '')
        if (itemSym !== segment.symbol) return false
      }
      return item.title === segment.title || item.title.includes(segment.title)
    }

    function searchPath(items, segIndex = 0) {
      const targetSeg = normalizedSegments[segIndex]
      for (const item of items) {
        if (matchItem(item, targetSeg)) {
          if (segIndex === normalizedSegments.length - 1) {
            return item
          }
          if (item.children?.length) {
            const foundChild = searchPath(item.children, segIndex + 1)
            if (foundChild) return foundChild
          }
        }
        if (segIndex === 0 && item.children?.length) {
          const found = searchPath(item.children, 0)
          if (found) return found
        }
      }
      return null
    }

    baseScopeItem = searchPath(parsed.tree, 0)
    if (baseScopeItem) {
      targetItems = [baseScopeItem]
    }
  }

  const seenNodes = new Set()
  const lines = []

  function renderTree(items, currentDepth = 0) {
    for (const item of items) {
      const prefix = '  '.repeat(currentDepth)
      let line = ''
      if (item.kind === 'structure') {
        line = `${prefix}#${item.title}`
      } else {
        const sym = item.symbol ?? (symbolByType[item.nodeType] ?? '?')
        line = `${prefix}${sym}${item.title}`
        if (includeStatus) {
          const nodeKey = `${item.nodeType}:${item.title}`
          if (!seenNodes.has(nodeKey)) {
            seenNodes.add(nodeKey)
            const node = nodes[item.nodeId] ?? Object.values(nodes).find((n) => n.type === item.nodeType && n.title === item.title)
            if (node) {
              const statusStr = overviewStatuses(node.fields ?? fieldStatus(node))
              if (statusStr) line += ` {${statusStr}}`
            }
          }
        }
      }
      lines.push(line)

      if (currentDepth + 1 <= maxDepth && item.children?.length > 0) {
        renderTree(item.children, currentDepth + 1)
      }
    }
  }

  renderTree(targetItems, 0)

  return {
    lines,
    markdown,
    nodeCount: project.nodes.length,
    scope,
    depth: maxDepth,
    includeStatus,
    issues,
  }
}

export async function writeProjectMarkdown(projectRoot, newMarkdown) {
  const root = await assertProjectRoot(projectRoot)
  let markdown = typeof newMarkdown === 'string' ? newMarkdown : ''
  if (markdown.trim() && !markdown.includes('<project-structure>')) {
    markdown = `<project-structure>\n${markdown.trim()}\n</project-structure>`
  }
  const cleanMarkdown = stripOutlineAnnotations(markdown)
  await saveProjectMarkdown(root, cleanMarkdown)
  await signalProjectChanged(root, 'write_markdown')
  return {
    applied: true,
    characters: cleanMarkdown.length,
    lines: cleanMarkdown.split('\n').length,
  }
}

export async function setProjectStructure(projectRoot, newMarkdown) {
  const root = await assertProjectRoot(projectRoot)
  const project = await openLocalProject(root)
  let markdown = typeof newMarkdown === 'string' ? newMarkdown : ''
  if (markdown.trim() && !markdown.includes('<project-structure>')) {
    markdown = `<project-structure>\n${markdown.trim()}\n</project-structure>`
  }
  const parsed = parseProject(markdown)
  const issues = [...parsed.issues]
  const nodes = mergeProjectNodes(parsed, project.nodes, project.retainedNodes, issues)

  if (issues.some((issue) => issue.severity === 'error')) {
    return { applied: false, issues, nodeCount: project.nodes.length }
  }
  const cleanMarkdown = stripOutlineAnnotations(markdown)
  const saved = await saveProjectSnapshot(root, { markdown: cleanMarkdown, nodes: Object.values(nodes) })
  await signalProjectChanged(root, 'set_structure')
  return {
    applied: true,
    issues,
    nodeCount: saved.nodes.length,
    retainedNodeCount: saved.retainedNodes.length,
  }
}

export async function replaceProjectStructure(projectRoot, targetContent, replacementContent) {
  const root = await assertProjectRoot(projectRoot)
  const project = await openLocalProject(root)
  const currentMarkdown = project.markdown ?? ''
  const updatedMarkdown = applyTargetReplace(currentMarkdown, targetContent, replacementContent, '项目大纲结构')
  return setProjectStructure(root, updatedMarkdown)
}

function parseResolutionsInput(input) {
  if (Array.isArray(input)) return input
  const str = String(input ?? '').trim()
  if (!str) throw new Error('缺少 resolve 操作列表')
  try {
    return JSON.parse(str)
  } catch {}
  const formatted = str
    .replace(/([a-zA-Z_\u4e00-\u9fa50-9-]+)/g, (match) => `"${match}"`)
    .replace(/"true"/g, 'true')
    .replace(/"false"/g, 'false')
    .replace(/"null"/g, 'null')
  try {
    return JSON.parse(formatted)
  } catch {
    throw new Error(`无法解析 resolve 操作列表：“${str}”，请使用 JSON 数组格式，例如: [["P", "名称", "新名称"], ["名称", "inherit"]]`)
  }
}

export async function resolveProjectHistory(projectRoot, resolutions, pendingMarkdown = null) {
  const root = await assertProjectRoot(projectRoot)
  const project = await openLocalProject(root)
  let markdown = typeof pendingMarkdown === 'string' && pendingMarkdown.trim().length > 0
    ? pendingMarkdown
    : (project.markdown ?? '')

  let actionList = parseResolutionsInput(resolutions)
  if (actionList.length > 0 && typeof actionList[0] === 'string') {
    actionList = [actionList]
  }

  const inheritedTitles = new Set()
  const renamedP = []
  const renamedH = []

  for (const action of actionList) {
    if (!Array.isArray(action)) continue
    const [typeOrName, arg1, arg2] = action
    const upper = String(typeOrName).toUpperCase()

    if (upper === 'P' && arg1 && arg2) {
      const regexDecl = new RegExp(`^(\\s*[$@%~&]\\s*)${escapeRegex(arg1)}(\\s*)$`, 'gm')
      markdown = markdown.replace(regexDecl, `$1${arg2}$2`)
      renamedP.push({ from: arg1, to: arg2 })
    } else if (upper === 'H' && arg1 && arg2) {
      await renameRetainedNode(root, arg1, arg2)
      renamedH.push({ from: arg1, to: arg2 })
    } else if (arg1 === 'inherit' || upper === 'INHERIT' || arg2 === 'inherit') {
      const inheritTarget = arg1 === 'inherit' ? typeOrName : (upper === 'INHERIT' ? arg1 : typeOrName)
      inheritedTitles.add(inheritTarget)
    }
  }

  const updatedParsed = parseProject(markdown)
  const issues = [...updatedParsed.issues]
  updatedParsed.declarations.forEach((decl) => {
    if (inheritedTitles.has(decl.title)) {
      decl.reused = true
    }
  })

  const freshProject = await openLocalProject(root)
  const nodes = mergeProjectNodes(updatedParsed, freshProject.nodes, freshProject.retainedNodes, issues)
  if (issues.some((issue) => issue.severity === 'error')) {
    return {
      applied: false,
      issues,
      nodeCount: freshProject.nodes.length,
      renamedP,
      renamedH,
      inherited: [...inheritedTitles],
    }
  }

  const saved = await saveProjectSnapshot(root, { markdown, nodes: Object.values(nodes) })
  await signalProjectChanged(root, 'resolve_history')

  return {
    applied: true,
    issues,
    nodeCount: saved.nodes.length,
    retainedNodeCount: saved.retainedNodes.length,
    renamedP,
    renamedH,
    inherited: [...inheritedTitles],
  }
}

export async function listProjectHistory(projectRoot) {
  const root = await assertProjectRoot(projectRoot)
  const project = await openLocalProject(root)
  return {
    retained: (project.retainedNodes ?? []).map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      symbol: symbolByType[node.type] ?? '',
      historyCount: (node.history ?? []).length,
      hasMedia: Boolean((node.history ?? []).find((v) => v.current)),
    })),
  }
}

export async function archiveProjectHistory(projectRoot, oldTitleOrId, newTitle) {
  const root = await assertProjectRoot(projectRoot)
  const result = await renameRetainedNode(root, oldTitleOrId, newTitle)
  await signalProjectChanged(root, 'archive_history')
  return result
}

export async function getProjectOverview(projectRoot) {
  return getProjectStructure(projectRoot, null, 'all', true)
}

function selectorMatches(selector, nodes, tree = []) {
  if (selector.isWildcard) {
    let candidateItems = []

    if (selector.scopePath) {
      const rawSegments = selector.scopePath.split('/').map((s) => s.trim()).filter(Boolean)
      const normalizedSegments = rawSegments.map((s) => {
        const symbol = '$@%~&#'.includes(s[0]) ? s[0] : null
        const title = s.replace(/^[#$@%~&\s]+/, '').trim()
        return { raw: s, symbol, title }
      })

      function matchItem(item, segment) {
        if (segment.symbol) {
          const itemSym = item.kind === 'structure' ? '#' : (item.symbol ?? symbolByType[item.nodeType] ?? '')
          if (itemSym !== segment.symbol) return false
        }
        return item.title === segment.title || item.title.includes(segment.title)
      }

      function searchPath(items, segIndex = 0) {
        const targetSeg = normalizedSegments[segIndex]
        for (const item of items) {
          if (matchItem(item, targetSeg)) {
            if (segIndex === normalizedSegments.length - 1) {
              return item
            }
            if (item.children?.length) {
              const foundChild = searchPath(item.children, segIndex + 1)
              if (foundChild) return foundChild
            }
          }
          if (segIndex === 0 && item.children?.length) {
            const found = searchPath(item.children, 0)
            if (found) return found
          }
        }
        return null
      }

      const baseItem = searchPath(tree, 0)
      if (!baseItem) return []

      if (selector.recursive) {
        function collectAll(items) {
          const result = []
          for (const item of items) {
            result.push(item)
            if (item.children?.length) result.push(...collectAll(item.children))
          }
          return result
        }
        candidateItems = collectAll(baseItem.children || [])
      } else {
        candidateItems = baseItem.children || []
      }
    } else {
      function collectAll(items) {
        const result = []
        for (const item of items) {
          result.push(item)
          if (item.children?.length) result.push(...collectAll(item.children))
        }
        return result
      }
      candidateItems = collectAll(tree)
    }

    const expectedType = selector.targetSymbol ? typeBySymbol[selector.targetSymbol] : null
    const matchedNodeMap = new Map()
    const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]))
    const nodeByTypeTitle = new Map(nodes.map((n) => [`${n.type}:${n.title}`, n]))

    for (const item of candidateItems) {
      if (item.kind === 'node') {
        const itemType = item.nodeType || typeBySymbol[item.symbol]
        if (!expectedType || itemType === expectedType) {
          const node = (item.nodeId && nodeById[item.nodeId]) || nodeByTypeTitle.get(`${itemType}:${item.title}`)
          if (node && !matchedNodeMap.has(node.id)) {
            matchedNodeMap.set(node.id, node)
          }
        }
      }
    }

    return Array.from(matchedNodeMap.values())
  }

  // Standard non-wildcard selector
  const expectedType = selector.symbol ? typeBySymbol[selector.symbol] : null
  const idMatch = expectedType ? null : nodes.find((node) => node.id === selector.title)
  if (idMatch) return [idMatch]

  return nodes.filter((node) => node.title === selector.title
    && (!expectedType || node.type === expectedType))
}

function queryFieldValue(node, field) {
  if (field === 'currentVersion') return node.history?.find((version) => version.current)
  if (field === 'model') return textTypes.has(node.type) ? undefined : generationPromptInfo(node.prompt).model
  if (field === 'generationConfig') {
    if (textTypes.has(node.type)) return undefined
    const info = generationPromptInfo(node.prompt)
    return info.error ? { error: info.error } : info.config
  }
  return node[field]
}

function formatParameterSummary(name, def, defaults) {
  const parts = []
  parts.push(def.type)
  if (def.enum) {
    parts.push(`[${def.enum.map((v) => JSON.stringify(v)).join('/')}]`)
  } else if (def.minimum !== undefined || def.maximum !== undefined) {
    const min = def.minimum !== undefined ? def.minimum : ''
    const max = def.maximum !== undefined ? def.maximum : ''
    parts.push(`(${min}~${max})`)
  }
  const defaultValue = defaults?.[name] ?? def.default
  if (defaultValue !== undefined) {
    parts.push(`默认: ${JSON.stringify(defaultValue)}`)
  }
  const desc = def.description ? ` - ${def.description}` : ''
  return `    • ${name}: ${parts.join(' ')}${desc}`
}

function formatSingleModel(model) {
  const lines = []
  lines.push(`● [${model.mediaType}] ${model.id} · ${model.name}`)
  if (model.description) {
    lines.push(`  - 场景与定位: ${model.description}`)
  }

  const caps = model.capabilities || {}
  const capParts = []
  if (caps.references?.length) {
    capParts.push(`引用类型: [${caps.references.join(', ')}]`)
  }
  if (caps.maxReferences !== undefined) {
    capParts.push(`最大引用数: ${caps.maxReferences}`)
  }
  if (caps.nativeAudio) {
    capParts.push(`原生音频: 支持`)
  }
  if (caps.modes?.length) {
    capParts.push(`支持模式: [${caps.modes.join(', ')}]`)
  }
  if (capParts.length) {
    lines.push(`  - 依赖与能力: ${capParts.join(' | ')}`)
  }

  const params = model.parameters || {}
  const paramKeys = Object.keys(params)
  if (paramKeys.length > 0) {
    lines.push(`  - 参数契约:`)
    paramKeys.forEach((key) => {
      lines.push(formatParameterSummary(key, params[key], model.defaults))
    })
  }

  const prompt = model.prompt || {}
  const promptParts = []
  if (prompt.language) {
    promptParts.push(`语言: ${prompt.language}`)
  }
  if (prompt.notes) {
    promptParts.push(`注意事项/禁忌: ${prompt.notes}`)
  }
  if (prompt.mediaAliases && Object.keys(prompt.mediaAliases).length > 0) {
    const aliases = Object.entries(prompt.mediaAliases).map(([k, v]) => `${k} -> "${v}"`).join(', ')
    promptParts.push(`别名映射: ${aliases}`)
  }
  if (promptParts.length) {
    lines.push(`  - 提示词规则:`)
    promptParts.forEach((part) => lines.push(`    • ${part}`))
  }

  return lines.join('\n')
}

export function formatGenerationModelCatalog(catalog) {
  const categoryHeaders = {
    video: '🎬 视频生成模型 (Video Models)',
    image: '🖼️ 图像生成模型 (Image Models)',
    audio: '🎙️ 音频生成模型 (Audio Models)',
  }

  const byType = { video: [], image: [], audio: [], other: [] }
  catalog.models.forEach((model) => {
    if (byType[model.mediaType]) {
      byType[model.mediaType].push(model)
    } else {
      byType.other.push(model)
    }
  })

  const output = []
  const order = ['video', 'image', 'audio', 'other']
  order.forEach((type) => {
    const list = byType[type]
    if (list && list.length > 0) {
      output.push(`================================================================================`)
      output.push(categoryHeaders[type] || `📦 其他模型 (${type})`)
      output.push(`================================================================================`)
      list.forEach((model) => {
        output.push(formatSingleModel(model))
        output.push('')
      })
    }
  })

  if (catalog.issues?.length) {
    output.push(`================================================================================`)
    output.push(`⚠️ 异常与告警`)
    output.push(`================================================================================`)
    catalog.issues.forEach((issue) => output.push(`! ${issue}`))
  }

  return output.join('\n').trim()
}

export async function runGenerationModelCommand(skillsRoot, args, isJson = false) {
  if (!skillsRoot) throw new Error('缺少 GRAPHVIDEO_GENERATION_MODELS_ROOT')
  const [action, value] = args
  if (action === 'list') {
    const catalog = await listGenerationModels(skillsRoot)
    return isJson ? JSON.stringify(catalog, null, 2) : formatGenerationModelCatalog(catalog)
  }
  if (action === 'get') {
    if (!value) throw new Error('model get 需要模型 ID')
    return JSON.stringify(await readGenerationModel(skillsRoot, value), null, 2)
  }
  if (action === 'put') {
    if (!value) throw new Error('model put 需要模型目录')
    const model = await importGenerationModel(skillsRoot, value, true)
    return `= model put ${model.id}`
  }
  if (action === 'delete') {
    if (!value) throw new Error('model delete 需要模型 ID')
    await deleteGenerationModel(skillsRoot, value)
    return `= model delete ${value}`
  }
  if (action === 'validate') {
    if (value) {
      const model = await readGenerationModel(skillsRoot, value)
      return `= model valid ${model.id}`
    }
    const catalog = await listGenerationModels(skillsRoot)
    if (catalog.issues.length) throw new Error(catalog.issues.join('\n'))
    return `= models valid count=${catalog.models.length}`
  }
  throw new Error('model 支持 list|get|put|delete|validate')
}

export async function queryProjectNodes(projectRoot, requests) {
  const root = await assertProjectRoot(projectRoot)
  const project = await openLocalProject(root)
  const parsed = parseProject(project.markdown)
  return {
    lines: requests.map((request) => ({
      line: request.line,
      fields: request.fields,
      selectors: request.selectors.map((selector) => ({
        raw: selector.raw,
        matches: selectorMatches(selector, project.nodes, parsed.tree).map((node) => ({
          id: node.id,
          type: node.type,
          title: node.title,
          fields: Object.fromEntries(request.fields.map((field) => [
            field, queryFieldValue(node, field),
          ])),
        })),
      })),
    })),
  }
}

function validateNodePatch(node, fields) {
  const keys = Object.keys(fields)
  if (keys.length === 0) throw new Error(`节点“${node.id}”没有提供要编辑的字段`)
  const unsupported = keys.filter((key) => !editableNodeFields.includes(key))
  if (unsupported.length) throw new Error(`节点“${node.id}”包含不可编辑字段：${unsupported.join(', ')}`)
  if (textTypes.has(node.type) && 'prompt' in fields) {
    throw new Error(`${node.type} 节点“${node.id}”不支持 prompt 字段`)
  }
  if (!textTypes.has(node.type) && 'content' in fields) {
    throw new Error(`${node.type} 节点“${node.id}”不支持 content 字段`)
  }
}

export async function editProjectNodes(projectRoot, updates) {
  const root = await assertProjectRoot(projectRoot)
  const project = await openLocalProject(root)
  const parsed = parseProject(project.markdown)
  const nodes = nodeRecord(project.nodes)
  const seen = new Set()
  const changes = updates.map(({ id: idOrSelector, fields }) => {
    let node = nodes[idOrSelector]
    if (!node) {
      const matches = selectorMatches(parseSelector(idOrSelector, 1), project.nodes, parsed.tree)
      if (matches.length === 1) node = matches[0]
      else if (matches.length > 1) {
        throw new Error(`节点选择器“${idOrSelector}”匹配到 ${matches.length} 个节点，请使用更精确的名称`)
      }
    }
    if (!node) throw new Error(`当前项目中不存在活动节点“${idOrSelector}”`)
    if (seen.has(node.id)) throw new Error(`批量编辑中重复提供节点“${node.title}” (${node.id})`)
    seen.add(node.id)
    validateNodePatch(node, fields)
    return { before: node, after: { ...node, ...fields } }
  })

  const updated = []
  for (const change of changes) updated.push(await saveProjectNode(root, change.after))
  await signalProjectChanged(root, 'edit_nodes')
  return {
    updated: updated.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      fields: fieldStatus(node),
    })),
  }
}

export async function replaceProjectNodeField(projectRoot, idOrSelector, field, targetContent, replacementContent) {
  const root = await assertProjectRoot(projectRoot)
  const project = await openLocalProject(root)
  const parsed = parseProject(project.markdown)
  const pathMeta = flattenTreeNodes(parsed.tree)
  const selector = parseSelector(idOrSelector, 1)
  const matches = selectorMatches(selector, project.nodes, pathMeta)

  if (matches.length === 0) throw new Error(`未找到匹配的节点：“${idOrSelector}”`)
  if (matches.length > 1) {
    throw new Error(`节点选择器“${idOrSelector}”匹配到 ${matches.length} 个节点，请使用层级路径（如：第1集/第1幕/@名称）`)
  }
  const node = matches[0]
  validateNodePatch(node, { [field]: '' })
  const currentValue = node[field] ?? ''
  const updatedValue = applyTargetReplace(currentValue, targetContent, replacementContent, `节点“${node.title}”字段“${field}”`)
  return editProjectNodes(root, [{ id: node.id, fields: { [field]: updatedValue } }])
}

export async function renameProjectEntity(projectRoot, oldSelector, newTitleOrSelector) {
  const root = await assertProjectRoot(projectRoot)
  const project = await openLocalProject(root)
  const parsed = parseProject(project.markdown)

  const oldSel = parseSelector(oldSelector, 1)
  const newSel = parseSelector(newTitleOrSelector, 1)

  let matches = selectorMatches(oldSel, project.nodes, parsed.tree)
  let isRetained = false
  if (matches.length === 0 && project.retainedNodes?.length) {
    matches = selectorMatches(oldSel, project.retainedNodes, [])
    if (matches.length > 0) isRetained = true
  }
  if (matches.length === 0) throw new Error(`未找到要重命名的节点：“${oldSelector}”`)
  if (matches.length > 1) throw new Error(`选择器“${oldSelector}”匹配到多个节点，请使用更精确的选择器`)

  const node = matches[0]
  const oldTitle = node.title
  const oldSym = symbolByType[node.type] ?? ''
  const newTitle = newSel.title
  const newSym = newSel.symbol ?? oldSym

  if (isRetained) {
    await renameRetainedNode(root, oldTitle, newTitle)
    await signalProjectChanged(root, 'rename_entity')
    return {
      node: { id: node.id, type: node.type, oldTitle, newTitle },
      affectedReferencesCount: 0,
      affectedNodes: [],
    }
  }

  // 1. Update markdown outline (replace all occurrences of the symbol+title token)
  const outlineTarget = `${oldSym}${oldTitle}`
  const outlineReplacement = `${newSym}${newTitle}`
  const outlineRegex = new RegExp(`(?<=^|\\s)${escapeRegex(outlineTarget)}(?=$|\\s)`, 'gm')
  const updatedMarkdown = project.markdown.replace(outlineRegex, outlineReplacement)

  // 2. Bracket reference patterns
  const oldRefBracket = `[${oldSym}${oldTitle}]`
  const newRefBracket = `[${newSym}${newTitle}]`

  const updatedNodes = []
  const affectedNodes = []

  for (const n of project.nodes) {
    let nodeModified = false
    const nodeCopy = { ...n }
    if (n.id === node.id) {
      nodeCopy.title = newTitle
      nodeModified = true
    }

    if (typeof nodeCopy.prompt === 'string' && nodeCopy.prompt.includes(oldRefBracket)) {
      nodeCopy.prompt = nodeCopy.prompt.replaceAll(oldRefBracket, newRefBracket)
      nodeModified = true
    }
    if (typeof nodeCopy.content === 'string' && nodeCopy.content.includes(oldRefBracket)) {
      nodeCopy.content = nodeCopy.content.replaceAll(oldRefBracket, newRefBracket)
      nodeModified = true
    }
    if (typeof nodeCopy.description === 'string' && nodeCopy.description.includes(oldRefBracket)) {
      nodeCopy.description = nodeCopy.description.replaceAll(oldRefBracket, newRefBracket)
      nodeModified = true
    }

    if (nodeModified) {
      updatedNodes.push(nodeCopy)
      if (n.id !== node.id) {
        affectedNodes.push({ id: n.id, title: n.title, type: n.type })
      }
    }
  }

  const updatedNodeMap = new Map(updatedNodes.map((n) => [n.id, n]))
  const finalNodes = project.nodes.map((n) => updatedNodeMap.get(n.id) ?? n)

  await saveProjectSnapshot(root, { markdown: updatedMarkdown, nodes: finalNodes })
  await signalProjectChanged(root, 'rename_entity')

  return {
    node: { id: node.id, type: node.type, oldTitle, newTitle },
    affectedReferencesCount: affectedNodes.length,
    affectedNodes,
  }
}

export async function patchProjectNodes(projectRoot, patches) {
  const root = await assertProjectRoot(projectRoot)
  const project = await openLocalProject(root)
  const nodes = nodeRecord(project.nodes)
  const nodeChanges = new Map()
  let structureUpdated = false
  let currentMarkdown = project.markdown ?? ''

  for (const patch of patches) {
    if (patch.type === 'structure') {
      currentMarkdown = applyTextHunks(currentMarkdown, patch.hunks, '项目大纲结构')
      structureUpdated = true
    } else {
      const { id, field, hunks } = patch
      let node = nodes[id]
      if (!node) {
        const parsed = parseProject(currentMarkdown)
        const matches = selectorMatches(parseSelector(id, 1), project.nodes, parsed.tree)
        if (matches.length === 1) node = matches[0]
        else if (matches.length > 1) {
          throw new Error(`补丁节点选择器“${id}”匹配到 ${matches.length} 个节点，请使用更精确的名称`)
        }
      }
      if (!node) throw new Error(`当前项目中不存在活动节点“${id}”`)
      validateNodePatch(node, { [field]: node[field] ?? '' })
      const current = nodeChanges.get(node.id) ?? { id: node.id, fields: {} }
      const value = current.fields[field] ?? node[field] ?? ''
      current.fields[field] = applyTextHunks(value, hunks, `节点“${node.title}”字段“${field}”`)
      nodeChanges.set(node.id, current)
    }
  }

  let structureResult = null
  if (structureUpdated) {
    structureResult = await setProjectStructure(root, currentMarkdown)
    if (!structureResult.applied) {
      throw new Error(`大纲结构补丁校验失败：${structureResult.issues.map((i) => i.message).join('; ')}`)
    }
  }

  const editResult = nodeChanges.size > 0
    ? await editProjectNodes(root, [...nodeChanges.values()])
    : { updated: [] }

  return {
    structureResult,
    updated: editResult.updated,
  }
}
