const MAX_NODES = 256
const MAX_JSON_DEPTH = 32
const APPROVED_CLASS_TYPES = new Set([
  'BasicGuider', 'BasicScheduler', 'ByteDance2FirstLastFrameNode',
  'ByteDance2ReferenceNodeV2', 'CLIPLoader', 'ComfyMathExpression',
  'ComfySwitchNode', 'CreateVideo', 'GeminiNanoBanana2V2', 'KSamplerSelect',
  'LoadAudio', 'LoadImage', 'LoadVideo', 'LoraLoaderModelOnly',
  'MiniMaxH3ReferenceToVideo', 'PrimitiveBoolean', 'PrimitiveFloat',
  'PrimitiveInt', 'PrimitiveStringMultiline', 'RandomNoise',
  'ResolutionSelector', 'SamplerCustomAdvanced', 'SaveImage', 'SaveVideo',
  'UNETLoader', 'VAEDecode', 'VAEDecodeAudio', 'VAELoader',
])
const DENIED_KEY = /(api[_-]?key|authorization|cookie|password|secret|token)/i
const PATH_KEY = /(file|filename|path|image|video|audio|vae_name|unet_name|clip_name|lora_name)/i

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`${label}包含未知字段: ${unknown.join(', ')}`)
}

function inspectJson(value, depth = 0, key = '') {
  if (depth > MAX_JSON_DEPTH) throw new Error(`workflow JSON 深度不能超过 ${MAX_JSON_DEPTH}`)
  if (typeof value === 'string' && PATH_KEY.test(key)) {
    if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.split(/[\\/]/).includes('..')) {
      throw new Error(`workflow 禁止绝对路径或路径穿越: ${key}`)
    }
  }
  if (!value || typeof value !== 'object') return
  for (const [childKey, child] of Object.entries(value)) {
    if (DENIED_KEY.test(childKey)) throw new Error(`workflow 禁止敏感字段: ${childKey}`)
    inspectJson(child, depth + 1, childKey)
  }
}

export function validateComfyWorkflowPackage(workflow, outputKind) {
  const graph = object(workflow, 'workflow.json')
  const entries = Object.entries(graph)
  if (entries.length === 0 || entries.length > MAX_NODES) throw new Error(`workflow 节点数必须在 1-${MAX_NODES} 之间`)
  inspectJson(graph)
  for (const [nodeId, rawNode] of entries) {
    if (!/^\d+$/.test(nodeId)) throw new Error(`workflow 节点 ID 必须是数字字符串: ${nodeId}`)
    const node = object(rawNode, `workflow.${nodeId}`)
    if (!APPROVED_CLASS_TYPES.has(node.class_type)) throw new Error(`workflow class_type 未批准: ${node.class_type}`)
    object(node.inputs ?? {}, `workflow.${nodeId}.inputs`)
  }
  const expectedSaver = outputKind === 'image' ? 'SaveImage' : outputKind === 'video' ? 'SaveVideo' : null
  if (!expectedSaver || !entries.some(([, node]) => node.class_type === expectedSaver)) {
    throw new Error(`workflow 必须由批准的 ${expectedSaver ?? outputKind} 节点产生输出`)
  }
  return graph
}

function bindingValue(binding, request) {
  if (binding.source === 'prompt') return request.inputs.prompt
  if (binding.source !== 'parameter') throw new Error(`binding.source 不受支持: ${binding.source}`)
  if (!Object.hasOwn(request.inputs, binding.name)) throw new Error(`binding 引用了未声明参数输出: ${binding.name}`)
  let value = request.inputs[binding.name]
  if (binding.transform === 'number') value = Number(value)
  if (binding.transform === 'aspectLabel') value = String(value).includes('16:9') ? '16:9 (Widescreen)' : '9:16 (Portrait)'
  if (binding.transform === 'spaceUnderscore') value = String(value).replaceAll(' ', '_')
  if (binding.prefix || binding.suffix) value = `${binding.prefix ?? ''}${value}${binding.suffix ?? ''}`
  return value
}

function applyBindings(graph, bindings, request) {
  for (const [index, rawBinding] of bindings.entries()) {
    const binding = object(rawBinding, `execution.bindings.${index}`)
    exactKeys(binding, new Set(['source', 'name', 'nodeId', 'input', 'when', 'value', 'transform', 'prefix', 'suffix']), `execution.bindings.${index}`)
    if (!['prompt', 'parameter'].includes(binding.source)) throw new Error(`binding.source 不受支持: ${binding.source}`)
    if (binding.when) {
      const when = object(binding.when, `execution.bindings.${index}.when`)
      exactKeys(when, new Set(['parameter', 'equals']), `execution.bindings.${index}.when`)
      if (request.inputs[when.parameter] !== when.equals) continue
    }
    const node = graph[String(binding.nodeId)]
    if (!node) throw new Error(`binding 目标节点不存在: ${binding.nodeId}`)
    node.inputs[binding.input] = binding.value !== undefined ? structuredClone(binding.value) : bindingValue(binding, request)
  }
}

function applyClearRules(graph, rules) {
  for (const [index, rawRule] of rules.entries()) {
    const rule = object(rawRule, `execution.clearInputPrefixes.${index}`)
    exactKeys(rule, new Set(['nodeId', 'prefixes']), `execution.clearInputPrefixes.${index}`)
    const inputs = graph[String(rule.nodeId)]?.inputs
    if (!inputs || !Array.isArray(rule.prefixes)) throw new Error(`clearInputPrefixes 目标无效: ${rule.nodeId}`)
    for (const key of Object.keys(inputs)) {
      if (rule.prefixes.some((prefix) => key.startsWith(prefix))) delete inputs[key]
    }
  }
}

function mediaReferences(request, type) {
  return (request.references ?? []).filter((reference) => reference.type === type && reference.filePath)
}

function applyReferenceSlots(graph, slots, request) {
  const uploads = []
  for (const [slotIndex, rawSlot] of slots.entries()) {
    const slot = object(rawSlot, `execution.referenceSlots.${slotIndex}`)
    exactKeys(slot, new Set([
      'type', 'maximum', 'nodeIdStart', 'loaderClass', 'loaderInput', 'targetNodeId',
      'targetInputPattern', 'titlePrefix', 'fixed',
    ]), `execution.referenceSlots.${slotIndex}`)
    if (!['image', 'video', 'audio'].includes(slot.type)) throw new Error(`referenceSlot.type 无效: ${slot.type}`)
    const references = mediaReferences(request, slot.type)
    if (references.length > slot.maximum) throw new Error(`${slot.type} 引用超过 execution slot 上限 ${slot.maximum}`)
    const fixed = Array.isArray(slot.fixed) ? slot.fixed : null
    for (const [index, reference] of references.entries()) {
      const target = fixed?.[index]
      if (fixed && !target) throw new Error(`${slot.type} 引用缺少固定槽位 ${index + 1}`)
      const nodeId = String(target?.nodeId ?? (Number(slot.nodeIdStart) + index))
      graph[nodeId] = {
        class_type: slot.loaderClass,
        inputs: { [slot.loaderInput]: '' },
        ...((slot.titlePrefix || target?.title) ? { _meta: { title: target?.title ?? `${slot.titlePrefix} ${index + 1}` } } : {}),
      }
      const targetNodeId = String(target?.targetNodeId ?? slot.targetNodeId)
      const targetNode = graph[targetNodeId]
      if (!targetNode) throw new Error(`referenceSlot 目标节点不存在: ${targetNodeId}`)
      const input = target?.targetInput ?? slot.targetInputPattern.replace('{ordinal}', String(index + 1)).replace('{index}', String(index))
      targetNode.inputs[input] = [nodeId, 0]
      uploads.push({ sourcePath: reference.filePath, nodeId, inputName: slot.loaderInput })
    }
  }
  return uploads
}

export function compileComfyTemplateV2(request) {
  const execution = request.model?.execution
  if (execution?.kind !== 'comfy-template') throw new Error('请求不是 comfy-template 执行族')
  const graph = structuredClone(validateComfyWorkflowPackage(request.model.workflow, execution.outputKind))
  applyClearRules(graph, execution.clearInputPrefixes ?? [])
  applyBindings(graph, execution.bindings ?? [], request)
  const uploads = applyReferenceSlots(graph, execution.referenceSlots ?? [], request)
  validateComfyWorkflowPackage(graph, execution.outputKind)
  return {
    provider: 'comfy',
    prompt: graph,
    uploads,
    workflowType: request.workflowType,
    expectedOutputKind: execution.outputKind,
  }
}

export const comfyWorkflowPackageLimits = Object.freeze({
  maxNodes: MAX_NODES,
  maxJsonDepth: MAX_JSON_DEPTH,
  approvedClassTypes: Object.freeze([...APPROVED_CLASS_TYPES].sort()),
})
