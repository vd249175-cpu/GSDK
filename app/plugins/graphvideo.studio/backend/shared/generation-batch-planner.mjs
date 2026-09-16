import { createHash } from 'node:crypto'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { buildModelRequestV2, compileModelIntentV2 } from './generation-model-intent-v2.mjs'
import { parseGenerationPrompt } from './generation-prompt.mjs'
import { orderedGenerationReferenceIds } from './generation-reference-order.mjs'

const mediaTypes = new Set(['image', 'video', 'audio'])

function modelSnapshot(catalog, modelId) {
  const snapshot = catalog?.models?.find((entry) => (
    entry.model.id === modelId || entry.model.aliases.includes(modelId)
  ))
  if (!snapshot) throw new Error(`生成目录快照缺少模型: ${modelId}`)
  return snapshot
}

function pathInside(root, candidate) {
  const rootPath = resolve(root)
  const target = resolve(rootPath, candidate)
  const nested = relative(rootPath, target)
  if (nested === '' || (nested !== '..' && !nested.startsWith(`..${sep}`) && !isAbsolute(nested))) return target
  throw new Error('项目媒体路径越出项目目录')
}

function currentVersion(node) {
  return (node.history ?? []).find((entry) => entry.current) ?? null
}

function structureDependencies(markdown, nodes) {
  const byTitle = new Map(nodes.flatMap((node) => [[node.title, node], [`${node.type}:${node.title}`, node]]))
  const dependencies = new Map(nodes.map((node) => [node.id, new Set()]))
  const stack = []
  let inside = false
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    if (line.includes('<project-structure>')) { inside = true; continue }
    if (line.includes('</project-structure>')) break
    if (!inside || !line.trim()) continue
    const indent = line.length - line.trimStart().length
    const text = line.trim()
    const symbol = text[0]
    const type = { '$': 'text', '@': 'image', '%': 'video', '~': 'audio', '&': 'style' }[symbol]
    const title = type || symbol === '#' ? text.slice(1).trim() : text
    const node = (type ? byTitle.get(`${type}:${title}`) : null) ?? byTitle.get(title)
    while (stack.length && stack.at(-1).indent >= indent) stack.pop()
    if (node) {
      for (const ancestor of [...stack].reverse()) {
        if (ancestor.node && mediaTypes.has(ancestor.node.type) && ancestor.node.id !== node.id) {
          dependencies.get(ancestor.node.id).add(node.id)
          break
        }
      }
    }
    stack.push({ indent, node })
  }
  return dependencies
}

function dependencyIds(node, nodes, structural) {
  const prompt = node.prompt ?? ''
  return orderedGenerationReferenceIds({
    prompt,
    nodes,
    targetNodeId: node.id,
    structuralIds: [...(structural.get(node.id) ?? [])],
  })
}

function referenceFor(projectRoot, node, ordinal) {
  const version = currentVersion(node)
  let filePath
  if (version?.relativePath) filePath = pathInside(projectRoot, version.relativePath)
  let metadata = {}
  if (node.type === 'audio') {
    try {
      const config = parseGenerationPrompt(node.prompt ?? '').config
      metadata = { voice_id: config.voice_id || config.voiceId }
    } catch {}
  }
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    ordinal,
    content: node.content ?? '',
    filePath,
    isReady: mediaTypes.has(node.type) ? Boolean(version && filePath) : Boolean(String(node.content ?? '').trim()),
    metadata,
  }
}

export function audioProjectIdentity(projectRoot) {
  const canonical = resolve(projectRoot).replaceAll('\\', '/').toLowerCase()
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 12)
  const prefix = basename(projectRoot).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'graphvideo'
  return { id: `${prefix}_${digest}`, name: basename(projectRoot) }
}

export function evaluateGenerationProject(project, catalog) {
  const nodes = project.nodes ?? []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const structural = structureDependencies(project.markdown, nodes)
  const dependencies = new Map(nodes.map((node) => [node.id, dependencyIds(node, nodes, structural)]))
  const levelOf = (id, visiting = new Set()) => {
    if (visiting.has(id)) return 0
    const next = new Set(visiting).add(id)
    return Math.max(0, ...(dependencies.get(id) ?? []).map((dep) => levelOf(dep, next) + 1))
  }
  return nodes.filter((node) => mediaTypes.has(node.type)).map((node) => {
    const ids = dependencies.get(node.id) ?? []
    const references = ids.map((id, index) => referenceFor(project.path, byId.get(id), index + 1))
    const missingDependencies = references.filter((entry) => !entry.isReady).map((entry) => entry.id)
    const hasCompletedMedia = Boolean(currentVersion(node))
    let modelId = null
    let status = 'READY'
    let reason = '提示词、参数与前置依赖均已就绪'
    let estimatedCredits = 0
    try {
      const parsed = parseGenerationPrompt(node.prompt ?? '')
      modelId = parsed.modelId
      if (!parsed.body.trim()) throw new Error('生成提示词正文不能为空')
      if (!modelId) {
        status = 'MANUAL'
        reason = '无模型声明，使用手动网页生成链路'
      } else if (missingDependencies.length) {
        status = 'MISSING_DEPENDENCIES'
        reason = '前置依赖尚未生成或缺少当前媒体文件'
      } else {
        const input = { nodeType: node.type, prompt: node.prompt, references }
        const snapshot = modelSnapshot(catalog, modelId)
        buildModelRequestV2(snapshot, input)
        estimatedCredits = compileModelIntentV2(snapshot, input).estimatedCredits
        if (hasCompletedMedia) {
          status = 'COMPLETED'
          reason = '本地媒体文件已就绪，可重新生成'
        }
      }
    } catch (error) {
      status = 'BLOCKED'
      reason = error instanceof Error ? error.message : String(error)
    }
    return {
      id: node.id,
      type: node.type,
      title: node.title,
      modelId,
      level: levelOf(node.id),
      dependencies: ids,
      resolvedDependencies: references.map(({ filePath: _filePath, isReady, ...entry }) => ({ ...entry, hasMedia: isReady })),
      hasCompletedMedia,
      readiness: { status, missingDependencies, reason },
      estimatedCredits,
    }
  })
}

function extensionFor(mediaType) {
  return mediaType === 'video' ? '.mp4' : mediaType === 'audio' ? '.wav' : '.png'
}

/** Pure batch planning. IDs are supplied by the owning Node's Runtime. */
export function planGenerationBatch(project, requests, options) {
  if (!options?.batchId || typeof options.nextId !== 'function') {
    throw new Error('生成批次规划必须由 Owner Node 提供 batchId 与 nextId')
  }
  const nodes = project.nodes ?? []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const structural = structureDependencies(project.markdown, nodes)
  const tasks = requests.map((request, index) => {
    const node = byId.get(request.nodeId)
    if (!node || !mediaTypes.has(node.type)) throw new Error(`找不到可生成的媒体节点: ${request.nodeId}`)
    const ids = dependencyIds(node, nodes, structural)
    const references = ids.map((id, ordinal) => referenceFor(project.path, byId.get(id), ordinal + 1))
    const versionId = `v-${options.nextId()}`
    return {
      taskId: `${options.batchId}:${index}:${node.id}`,
      targetNodeId: node.id,
      versionId,
      destinationRelativePath: `nodes/${node.id}/media/${versionId}${extensionFor(node.type)}`,
      mediaType: node.type,
      input: { nodeType: node.type, prompt: request.prompt ?? node.prompt ?? '', references },
    }
  })
  return {
    batchId: options.batchId,
    project: { ...audioProjectIdentity(project.path), ...(options.audioUrl ? { baseUrl: options.audioUrl } : {}) },
    tasks,
  }
}
