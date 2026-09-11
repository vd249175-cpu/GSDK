import { validateComfyWorkflowPackage } from './generation-workflow-package-v2.mjs'

const MODEL_FILE = 'model.json'
const EXECUTION_FILE = 'execution.json'
const WORKFLOW_FILE = 'workflow.json'
const MAX_FILE_BYTES = 1024 * 1024
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024
const MODEL_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MODEL_ALIAS = /^[a-z0-9][a-z0-9_.-]{0,63}$/
const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const MEDIA_TYPES = new Set(['image', 'video', 'audio'])
const PARAMETER_TYPES = new Set(['string', 'number', 'integer', 'boolean'])

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`${label}包含未知字段: ${unknown.join(', ')}`)
}

function requiredString(value, label, maximum = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
  if (value.length > maximum) throw new Error(`${label}不能超过${maximum}个字符`)
  return value
}

function jsonFile(files, name, required = true) {
  const raw = files[name]
  if (raw === undefined && !required) return undefined
  if (typeof raw !== 'string') throw new Error(`模型包缺少 ${name}`)
  const bytes = new TextEncoder().encode(raw).byteLength
  if (bytes > MAX_FILE_BYTES) throw new Error(`${name}不能超过1 MiB`)
  try {
    return { bytes, value: JSON.parse(raw) }
  } catch (error) {
    throw new Error(`${name}不是有效 JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function normalizeParameters(input, defaultsInput) {
  const source = object(input ?? {}, 'model.parameters')
  const defaults = object(defaultsInput ?? {}, 'model.defaults')
  const parameters = {}
  for (const [name, rawDefinition] of Object.entries(source)) {
    if (!PARAMETER_NAME.test(name)) throw new Error(`参数名无效: ${name}`)
    const definition = object(rawDefinition, `model.parameters.${name}`)
    exactKeys(definition, new Set(['type', 'description', 'enum', 'minimum', 'maximum', 'outputName']), `model.parameters.${name}`)
    const type = requiredString(definition.type, `model.parameters.${name}.type`, 10)
    if (!PARAMETER_TYPES.has(type)) throw new Error(`参数 ${name} 的类型不受支持`)
    if (definition.enum !== undefined && (!Array.isArray(definition.enum) || definition.enum.some((entry) => typeof entry !== 'string'))) {
      throw new Error(`model.parameters.${name}.enum必须是字符串数组`)
    }
    parameters[name] = structuredClone(definition)
  }
  const unknownDefaults = Object.keys(defaults).filter((name) => !Object.hasOwn(parameters, name))
  if (unknownDefaults.length) throw new Error(`默认值引用未声明参数: ${unknownDefaults.join(', ')}`)
  for (const [name, value] of Object.entries(defaults)) {
    const definition = parameters[name]
    const valid = definition.type === 'integer' ? Number.isInteger(value) : typeof value === definition.type
    if (!valid) throw new Error(`参数 ${name} 的默认值必须是 ${definition.type}`)
    if (definition.enum && !definition.enum.includes(value)) throw new Error(`参数 ${name} 的默认值不在 enum 中`)
    if (definition.minimum !== undefined && value < definition.minimum) throw new Error(`参数 ${name} 的默认值小于 minimum`)
    if (definition.maximum !== undefined && value > definition.maximum) throw new Error(`参数 ${name} 的默认值大于 maximum`)
  }
  return { parameters, defaults: structuredClone(defaults) }
}

function normalizeModel(input, directoryName) {
  const source = object(input, 'model.json')
  exactKeys(source, new Set([
    'schemaVersion', 'id', 'name', 'description', 'mediaType', 'provider', 'apiModel',
    'parameters', 'defaults', 'capabilities', 'prompt', 'dependencies', 'budget', 'variants', 'aliases', 'aliasDefaults',
  ]), 'model.json')
  if (source.schemaVersion !== 2) throw new Error('model.json schemaVersion 必须是 2')
  const id = requiredString(source.id, 'model.id', 64)
  if (!MODEL_ID.test(id)) throw new Error('model.id 无效')
  if (id !== directoryName) throw new Error('模型目录名必须与 model.id 相同')
  const mediaType = requiredString(source.mediaType, 'model.mediaType', 10)
  if (!MEDIA_TYPES.has(mediaType)) throw new Error('model.mediaType只能是image、video或audio')
  const { parameters, defaults } = normalizeParameters(source.parameters, source.defaults)
  const aliases = source.aliases ?? []
  if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== 'string' || !MODEL_ALIAS.test(alias)) || new Set(aliases).size !== aliases.length) {
    throw new Error('model.aliases必须是无重复的有效模型 ID 数组')
  }
  const rawAliasDefaults = object(source.aliasDefaults ?? {}, 'model.aliasDefaults')
  const unknownAliases = Object.keys(rawAliasDefaults).filter((alias) => !aliases.includes(alias))
  if (unknownAliases.length) throw new Error(`aliasDefaults 引用未声明 alias: ${unknownAliases.join(', ')}`)
  const aliasDefaults = Object.fromEntries(Object.entries(rawAliasDefaults).map(([alias, values]) => [
    alias,
    normalizeParameters(parameters, values).defaults,
  ]))
  return {
    schemaVersion: 2,
    id,
    name: requiredString(source.name, 'model.name', 100),
    description: requiredString(source.description, 'model.description'),
    mediaType,
    provider: requiredString(source.provider, 'model.provider', 100),
    apiModel: requiredString(source.apiModel ?? id, 'model.apiModel', 200),
    parameters,
    defaults,
    capabilities: structuredClone(object(source.capabilities ?? {}, 'model.capabilities')),
    prompt: structuredClone(object(source.prompt ?? {}, 'model.prompt')),
    dependencies: structuredClone(object(source.dependencies ?? {}, 'model.dependencies')),
    budget: structuredClone(object(source.budget ?? { kind: 'free' }, 'model.budget')),
    variants: Array.isArray(source.variants) ? structuredClone(source.variants) : [],
    aliases: structuredClone(aliases),
    aliasDefaults: structuredClone(aliasDefaults),
  }
}

function normalizeExecution(input, mediaType) {
  const source = object(input, 'execution.json')
  if (source.schemaVersion !== 2) throw new Error('execution.json schemaVersion 必须是 2')
  const kind = requiredString(source.kind, 'execution.kind', 30)
  if (kind === 'mock') {
    exactKeys(source, new Set(['schemaVersion', 'kind', 'outputKind']), 'execution.json')
    if (!['image', 'video'].includes(source.outputKind)) throw new Error('mock outputKind 必须是 image 或 video')
    return structuredClone(source)
  }
  if (kind === 'audio-task') {
    exactKeys(source, new Set(['schemaVersion', 'kind', 'taskType', 'payload']), 'execution.json')
    if (mediaType !== 'audio') throw new Error('audio-task 只能用于 audio 模型')
    if (!['SFX', 'SPEECH', 'VOICE_DESIGN', 'VOICE_CLONE'].includes(source.taskType)) throw new Error('audio-task taskType 无效')
    object(source.payload ?? {}, 'execution.payload')
    return structuredClone(source)
  }
  if (kind === 'comfy-template') {
    exactKeys(source, new Set(['schemaVersion', 'kind', 'workflow', 'outputKind', 'bindings', 'referenceSlots', 'clearInputPrefixes']), 'execution.json')
    if (source.workflow !== WORKFLOW_FILE) throw new Error('comfy-template workflow 必须是 workflow.json')
    if (!MEDIA_TYPES.has(source.outputKind) || source.outputKind !== mediaType) throw new Error('comfy-template outputKind 必须与模型媒体类型一致')
    if (!Array.isArray(source.bindings ?? [])) throw new Error('execution.bindings必须是数组')
    if (!Array.isArray(source.referenceSlots ?? [])) throw new Error('execution.referenceSlots必须是数组')
    if (!Array.isArray(source.clearInputPrefixes ?? [])) throw new Error('execution.clearInputPrefixes必须是数组')
    return structuredClone({
      ...source,
      bindings: source.bindings ?? [],
      referenceSlots: source.referenceSlots ?? [],
      clearInputPrefixes: source.clearInputPrefixes ?? [],
    })
  }
  throw new Error(`execution.kind 不受支持: ${kind}`)
}

export function parseGenerationModelPackage({ directoryName, files }) {
  if (!MODEL_ID.test(directoryName ?? '')) throw new Error('模型目录名无效')
  const entries = object(files, '模型包文件')
  const unknownFiles = Object.keys(entries).filter((name) => ![MODEL_FILE, EXECUTION_FILE, WORKFLOW_FILE].includes(name))
  if (unknownFiles.length) throw new Error(`模型包包含不允许的文件: ${unknownFiles.join(', ')}`)
  const modelFile = jsonFile(entries, MODEL_FILE)
  const executionFile = jsonFile(entries, EXECUTION_FILE)
  const model = normalizeModel(modelFile.value, directoryName)
  const execution = normalizeExecution(executionFile.value, model.mediaType)
  const workflowFile = jsonFile(entries, WORKFLOW_FILE, execution.kind === 'comfy-template')
  if (execution.kind !== 'comfy-template' && workflowFile) throw new Error('只有 comfy-template 模型允许 workflow.json')
  const totalBytes = modelFile.bytes + executionFile.bytes + (workflowFile?.bytes ?? 0)
  if (totalBytes > MAX_PACKAGE_BYTES) throw new Error('模型包不能超过2 MiB')
  const workflow = workflowFile ? structuredClone(object(workflowFile.value, 'workflow.json')) : undefined
  if (workflow) validateComfyWorkflowPackage(workflow, execution.outputKind)
  const snapshot = {
    schemaVersion: 2,
    model,
    execution,
    ...(workflow ? { workflow } : {}),
  }
  structuredClone(snapshot)
  return snapshot
}

export const generationModelPackageLimits = Object.freeze({
  maxFileBytes: MAX_FILE_BYTES,
  maxPackageBytes: MAX_PACKAGE_BYTES,
})
