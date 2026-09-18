// ComfyUI 工作流统一接口：一套 schema + 绑定替换 + payload 构建 + 执行。
// 纯数据部分不依赖 Node/DOM；执行部分通过注入的 fetch 访问本机 ComfyUI，
// 供 agent skills（生成模型）、页面和脚本共用。
/* global structuredClone, URLSearchParams, setTimeout */

const mediaTypes = new Set(['image', 'video', 'audio'])
const workflowIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/
const bindingNamePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const bindingKinds = new Set(['scalar', 'media-list'])
const mediaShapes = new Set(['list', 'slots'])
const slotSegmentPattern = /^[A-Za-z][A-Za-z0-9_]*$/
const outputKinds = [
  ['image', 'images'],
  ['gif', 'gifs'],
  ['video', 'videos'],
  ['audio', 'audio'],
]
// media-list 绑定按媒体类型创建 ComfyUI 内置加载器节点（文件名来自 input 目录）。
const loaderNodes = {
  image: { class_type: 'LoadImage', input: 'image' },
  video: { class_type: 'LoadVideo', input: 'file' },
  audio: { class_type: 'LoadAudio', input: 'audio' },
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是对象`)
  }
  return value
}

function optionalRecord(value, label) {
  return value === undefined ? {} : record(value, label)
}

function requiredString(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
  if (value.length > maximum) throw new Error(`${label}不能超过${maximum}个字符`)
  return value
}

function isScalar(value) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function validateGraph(value) {
  const graph = record(value, 'graph')
  const nodes = {}
  for (const [nodeId, node] of Object.entries(graph)) {
    const entry = record(node, `graph.${nodeId}`)
    const classType = requiredString(entry.class_type, `graph.${nodeId}.class_type`, 200)
    const inputs = structuredClone(record(entry.inputs, `graph.${nodeId}.inputs`))
    nodes[nodeId] = { class_type: classType, inputs }
  }
  if (Object.keys(nodes).length === 0) throw new Error('graph不能为空')
  return nodes
}

function validateBindings(value, graph) {
  const bindings = optionalRecord(value, 'bindings')
  return Object.fromEntries(Object.entries(bindings).map(([name, target]) => {
    if (!bindingNamePattern.test(name)) throw new Error(`绑定名无效：${name}`)
    const source = record(target, `bindings.${name}`)
    const node = requiredString(source.node, `bindings.${name}.node`, 64)
    const input = requiredString(source.input, `bindings.${name}.input`, 64)
    if (!Object.hasOwn(graph, node)) throw new Error(`绑定 ${name} 指向不存在的节点：${node}`)
    const kind = source.kind ?? 'scalar'
    if (!bindingKinds.has(kind)) throw new Error(`bindings.${name}.kind 只能是 scalar 或 media-list`)
    if (kind === 'scalar') {
      if (!Object.hasOwn(graph[node].inputs, input)) {
        throw new Error(`绑定 ${name} 指向不存在的输入：${node}.${input}`)
      }
      return [name, { node, input, kind }]
    }
    // media-list：槽位由绑定独占，允许图中不存在（slots 为 min 0 编号组，list 为空时删除键）。
    const media = requiredString(source.media, `bindings.${name}.media`, 10)
    if (!mediaTypes.has(media)) throw new Error(`bindings.${name}.media 只能是 image、video 或 audio`)
    const shape = requiredString(source.shape, `bindings.${name}.shape`, 10)
    if (!mediaShapes.has(shape)) throw new Error(`bindings.${name}.shape 只能是 list 或 slots`)
    const normalized = { node, input, kind, media, shape }
    if (shape === 'slots') {
      if (!input.endsWith('.')) throw new Error(`bindings.${name} slots 形状的 input 必须是点号结尾的键前缀`)
      const slotPrefix = requiredString(source.slotPrefix, `bindings.${name}.slotPrefix`, 32)
      if (!slotSegmentPattern.test(slotPrefix)) {
        throw new Error(`bindings.${name}.slotPrefix 只能使用字母、数字和下划线`)
      }
      normalized.slotPrefix = slotPrefix
    }
    if (source.maxCount !== undefined) {
      if (!Number.isInteger(source.maxCount) || source.maxCount < 1) {
        throw new Error(`bindings.${name}.maxCount 必须是正整数`)
      }
      normalized.maxCount = source.maxCount
    }
    return [name, normalized]
  }))
}

function validateDefaults(value, bindings) {
  const defaults = optionalRecord(value, 'defaults')
  const unknown = Object.keys(defaults).filter((name) => !Object.hasOwn(bindings, name))
  if (unknown.length) throw new Error(`未声明绑定的默认值：${unknown.join(', ')}`)
  Object.entries(defaults).forEach(([name, entry]) => {
    const binding = bindings[name]
    if (binding.kind === 'media-list') {
      if (!Array.isArray(entry) || entry.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new Error(`默认值 ${name} 必须是文件名数组`)
      }
      if (binding.maxCount !== undefined && entry.length > binding.maxCount) {
        throw new Error(`默认值 ${name} 超过最大数量 ${binding.maxCount}`)
      }
      return
    }
    if (!isScalar(entry)) throw new Error(`默认值 ${name} 必须是字符串、数字或布尔值`)
  })
  return structuredClone(defaults)
}

function normalizeBaseUrl(value) {
  if (value === undefined) return undefined
  const url = requiredString(value, 'baseUrl', 500)
  if (!/^https?:\/\//.test(url)) throw new Error('baseUrl 必须是 http(s) URL')
  return url.replace(/\/+$/, '')
}

/** 校验并归一化统一工作流配置（去掉节点上的 _meta 等多余字段）。 */
export function validateComfyUiWorkflow(input) {
  const source = record(input, '工作流配置')
  if (source.schemaVersion !== 1) throw new Error('schemaVersion必须是1')
  const id = source.id
  if (typeof id !== 'string' || !workflowIdPattern.test(id)) {
    throw new Error('id 只能使用小写字母、数字、连字符和下划线，且不超过 64 个字符')
  }
  const mediaType = requiredString(source.mediaType, 'mediaType', 10)
  if (!mediaTypes.has(mediaType)) throw new Error('mediaType只能是image、video或audio')
  const graph = validateGraph(source.graph)
  const bindings = validateBindings(source.bindings, graph)
  return {
    schemaVersion: 1,
    id,
    name: requiredString(source.name, 'name', 100),
    description: requiredString(source.description, 'description', 500),
    mediaType,
    provider: requiredString(source.provider ?? 'comfyui', 'provider', 100),
    baseUrl: normalizeBaseUrl(source.baseUrl),
    graph,
    bindings,
    defaults: validateDefaults(source.defaults, bindings),
  }
}

function validateMediaListValue(binding, name, value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`参数 ${name} 必须是文件名数组`)
  }
  if (binding.maxCount !== undefined && value.length > binding.maxCount) {
    throw new Error(`参数 ${name} 最多 ${binding.maxCount} 个文件`)
  }
  return [...value]
}

/** 把声明过的绑定值（defaults + 覆盖值）写进 graph 副本，返回 API-format 节点图。 */
export function applyComfyUiBindings(config, values = {}) {
  const overrides = record(values, '生成参数')
  const unknown = Object.keys(overrides).filter((name) => !Object.hasOwn(config.bindings, name))
  if (unknown.length) throw new Error(`工作流不支持参数：${unknown.join(', ')}`)
  const effective = { ...config.defaults, ...overrides }
  const graph = structuredClone(config.graph)
  let loaderCounter = 0
  const freshLoaderId = (media) => {
    for (;;) {
      loaderCounter += 1
      const candidate = `graphvideo-load-${media}-${loaderCounter}`
      if (!Object.hasOwn(graph, candidate)) return candidate
    }
  }
  let batchCounter = 0
  const freshBatchId = () => {
    for (;;) {
      batchCounter += 1
      const candidate = `graphvideo-batch-image-${batchCounter}`
      if (!Object.hasOwn(graph, candidate)) return candidate
    }
  }
  Object.entries(effective).forEach(([name, value]) => {
    const target = config.bindings[name]
    if (target.kind === 'media-list') {
      const filenames = validateMediaListValue(target, name, value)
      const loader = loaderNodes[target.media]
      const links = filenames.map((filename) => {
        const loaderId = freshLoaderId(target.media)
        graph[loaderId] = { class_type: loader.class_type, inputs: { [loader.input]: filename } }
        return [loaderId, 0]
      })
      const inputs = graph[target.node].inputs
      if (target.shape === 'slots') {
        Object.keys(inputs).forEach((key) => { if (key.startsWith(target.input)) delete inputs[key] })
        links.forEach((link, index) => {
          inputs[`${target.input}${target.slotPrefix}_${index + 1}`] = link
        })
        return
      }
      if (links.length === 0) {
        delete inputs[target.input]
      } else {
        inputs[target.input] = links
      }
      return
    }
    if (!isScalar(value)) throw new Error(`参数 ${name} 必须是字符串、数字或布尔值`)
    graph[target.node].inputs[target.input] = value
  })
  return graph
}

/** 构建 POST /prompt 的请求体。 */
export function buildComfyUiPrompt(config, values = {}, clientId = undefined) {
  const payload = { prompt: applyComfyUiBindings(config, values) }
  if (clientId) payload.client_id = clientId
  return payload
}

/** 把 ComfyUI history 里的输出条目拼成 /view 地址。 */
export function comfyUiViewUrl(baseUrl, output) {
  const params = new URLSearchParams()
  for (const key of ['filename', 'subfolder', 'type']) {
    if (output[key]) params.set(key, output[key])
  }
  return `${baseUrl.replace(/\/+$/, '')}/view?${params.toString()}`
}

function sleep(milliseconds) {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds) })
}

function randomClientId() {
  const cryptoGlobal = globalThis.crypto
  if (typeof cryptoGlobal?.randomUUID === 'function') return `graphvideo-${cryptoGlobal.randomUUID()}`
  return `graphvideo-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function readPromptId(response, endpoint) {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    let detail = ''
    if (payload?.error) {
      const message = typeof payload.error === 'string'
        ? payload.error
        : payload.error?.message ?? JSON.stringify(payload.error)
      detail = `：${message}`
    }
    throw new Error(`ComfyUI /prompt 返回 ${response.status}${detail}`)
  }
  const promptId = payload?.prompt_id
  if (typeof promptId !== 'string' || !promptId) {
    throw new Error(`ComfyUI ${endpoint} /prompt 响应缺少 prompt_id`)
  }
  return promptId
}

function summarizeMessages(messages) {
  if (!Array.isArray(messages)) return '未知错误'
  const lines = messages
    .map((group) => (Array.isArray(group) ? group.filter((item) => typeof item === 'string').join(': ') : ''))
    .filter(Boolean)
  return lines.join('；') || '未知错误'
}

function collectOutputs(outputs, endpoint) {
  const collected = []
  Object.values(outputs ?? {}).forEach((nodeOutputs) => {
    if (!nodeOutputs || typeof nodeOutputs !== 'object') return
    for (const [kind, key] of outputKinds) {
      const entries = nodeOutputs[key]
      if (!Array.isArray(entries)) continue
      for (const entry of entries) {
        if (!entry?.filename) continue
        collected.push({
          kind,
          filename: entry.filename,
          subfolder: entry.subfolder ?? '',
          type: entry.type ?? 'output',
          url: comfyUiViewUrl(endpoint, entry),
        })
      }
    }
  })
  return collected
}

/**
 * 执行一次工作流：POST /prompt 后轮询 /history/{promptId}，完成后收集全部输出。
 * options.fetch 缺省使用 globalThis.fetch；超时、执行错误都归一化为异常。
 */
export async function runComfyUiWorkflow(config, options = {}) {
  const {
    values = {},
    baseUrl = config.baseUrl ?? 'http://127.0.0.1:8000',
    clientId = randomClientId(),
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = 300_000,
    pollIntervalMs = 1500,
  } = options
  if (typeof fetchImpl !== 'function') throw new Error('缺少 fetch 实现（options.fetch）')
  const endpoint = baseUrl.replace(/\/+$/, '')
  const payload = buildComfyUiPrompt(config, values, clientId)
  const promptResponse = await fetchImpl(`${endpoint}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const promptId = await readPromptId(promptResponse, endpoint)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`ComfyUI 执行超时（${timeoutMs / 1000}s）：${promptId}`)
    const historyResponse = await fetchImpl(`${endpoint}/history/${encodeURIComponent(promptId)}`)
    const history = await historyResponse.json().catch(() => ({}))
    const entry = history[promptId]
    if (entry?.status?.status_str === 'error') {
      throw new Error(`ComfyUI 执行失败：${summarizeMessages(entry.status.messages)}`)
    }
    if (entry?.status?.completed === true) {
      return { promptId, outputs: collectOutputs(entry.outputs, endpoint) }
    }
    await sleep(Math.min(pollIntervalMs, remaining))
  }
}
