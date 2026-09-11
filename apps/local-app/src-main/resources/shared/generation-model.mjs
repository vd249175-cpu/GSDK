import { validateGenerationModelId } from './generation-prompt.mjs'

const mediaTypes = new Set(['image', 'video', 'audio'])
const parameterTypes = new Set(['string', 'number', 'integer', 'boolean'])

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象`)
  return value
}

function optionalRecord(value, label) {
  return value === undefined ? {} : record(value, label)
}

function requiredString(value, label, maximum = 200) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
  if (value.length > maximum) throw new Error(`${label}不能超过${maximum}个字符`)
  return value
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item)) {
    throw new Error(`${label}必须是字符串数组`)
  }
  return [...new Set(value)]
}

function parameterDefinitions(value) {
  const definitions = optionalRecord(value, 'parameters')
  return Object.fromEntries(Object.entries(definitions).map(([name, input]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) throw new Error(`参数名无效：${name}`)
    const definition = record(input, `parameters.${name}`)
    const type = requiredString(definition.type, `parameters.${name}.type`, 10)
    if (!parameterTypes.has(type)) throw new Error(`parameters.${name}.type不受支持`)
    const normalized = { type }
    if (definition.description !== undefined) {
      normalized.description = requiredString(definition.description, `parameters.${name}.description`, 300)
    }
    if (definition.enum !== undefined) normalized.enum = stringArray(definition.enum, `parameters.${name}.enum`)
    if (Number.isFinite(definition.minimum)) normalized.minimum = definition.minimum
    if (Number.isFinite(definition.maximum)) normalized.maximum = definition.maximum
    return [name, normalized]
  }))
}

function validateParameter(name, value, definition) {
  const actualType = typeof value
  if (definition.type === 'integer' ? !Number.isInteger(value) : actualType !== definition.type) {
    throw new Error(`参数 ${name} 必须是 ${definition.type}`)
  }
  if (definition.enum && !definition.enum.includes(value)) throw new Error(`参数 ${name} 不在允许范围内`)
  if (definition.minimum !== undefined && value < definition.minimum) throw new Error(`参数 ${name} 不能小于 ${definition.minimum}`)
  if (definition.maximum !== undefined && value > definition.maximum) throw new Error(`参数 ${name} 不能大于 ${definition.maximum}`)
  return value
}

export function validateGenerationModelManifest(input) {
  const source = record(input, 'model')
  if (source.schemaVersion !== 1) throw new Error('schemaVersion必须是1')
  const mediaType = requiredString(source.mediaType, 'mediaType', 10)
  if (!mediaTypes.has(mediaType)) throw new Error('mediaType只能是image、video或audio')
  const entrypoints = optionalRecord(source.entrypoints, 'entrypoints')
  const capabilities = optionalRecord(source.capabilities, 'capabilities')
  const parameters = parameterDefinitions(source.parameters)
  const defaults = optionalRecord(source.defaults, 'defaults')
  validateGenerationParameters(parameters, defaults)
  return {
    schemaVersion: 1,
    id: validateGenerationModelId(source.id),
    name: requiredString(source.name, 'name', 100),
    description: requiredString(source.description, 'description', 500),
    mediaType,
    provider: requiredString(source.provider ?? 'comfyui', 'provider', 100),
    apiModel: requiredString(source.apiModel ?? source.id, 'apiModel', 200),
    entrypoints: {
      promptParser: entrypoints.promptParser ? requiredString(entrypoints.promptParser, 'entrypoints.promptParser', 200) : 'index.mjs',
      apiAdapter: entrypoints.apiAdapter ? requiredString(entrypoints.apiAdapter, 'entrypoints.apiAdapter', 200) : 'index.mjs',
    },
    capabilities: {
      modes: stringArray(capabilities.modes ?? [], 'capabilities.modes'),
      references: stringArray(capabilities.references ?? [], 'capabilities.references'),
      nativeAudio: capabilities.nativeAudio === true,
      maxReferences: Number.isInteger(capabilities.maxReferences) ? capabilities.maxReferences : undefined,
    },
    parameters,
    defaults,
    pricing: source.pricing ? {
      defaultCredits: Number(source.pricing.defaultCredits ?? 0),
      unit: String(source.pricing.unit ?? 'credits'),
    } : undefined,
    prompt: optionalRecord(source.prompt ?? source.promptRules, 'prompt'),
    api: optionalRecord(source.api, 'api'),
  }
}

export function validateGenerationParameters(definitions, values) {
  const source = optionalRecord(values, '生成参数')
  const unknown = Object.keys(source).filter((name) => !Object.hasOwn(definitions, name))
  if (unknown.length) throw new Error(`模型不支持参数：${unknown.join(', ')}`)
  return Object.fromEntries(Object.entries(source).map(([name, value]) => [
    name, validateParameter(name, value, definitions[name]),
  ]))
}
