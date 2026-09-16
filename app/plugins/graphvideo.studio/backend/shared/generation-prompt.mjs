import { parse, stringify } from 'yaml'

const modelIdPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/

function frontMatterParts(source) {
  if (typeof source !== 'string') throw new Error('生成提示词必须是字符串')
  const normalized = source.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0]?.trim() !== '---') {
    return { body: normalized, header: '', hasFrontMatter: false }
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) throw new Error('提示词 YAML 头部缺少结束分隔符 ---')
  return {
    header: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n').replace(/^\n/, ''),
    hasFrontMatter: true,
  }
}

function configRecord(value) {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('提示词 YAML 头部必须是对象')
  }
  return value
}

export function validateGenerationModelId(value) {
  if (typeof value !== 'string' || !modelIdPattern.test(value)) {
    throw new Error('model 只能使用小写字母、数字、连字符和下划线，且不超过 64 个字符')
  }
  return value
}

export function parseGenerationPrompt(source) {
  const parts = frontMatterParts(source)
  if (!parts.hasFrontMatter) {
    return { body: parts.body, config: {}, hasFrontMatter: false, modelId: null }
  }
  let config
  try {
    config = configRecord(parse(parts.header) ?? {})
  } catch (error) {
    throw new Error(`提示词 YAML 无效：${error instanceof Error ? error.message : '无法解析'}`, {
      cause: error,
    })
  }
  const modelId = config.model === undefined ? null : validateGenerationModelId(config.model)
  return { body: parts.body, config, hasFrontMatter: true, modelId }
}

export function stripGenerationPromptFrontMatter(source) {
  return frontMatterParts(source).body.trim()
}

export function setGenerationPromptModel(source, modelId) {
  const parsed = parseGenerationPrompt(source)
  const config = { ...parsed.config, model: validateGenerationModelId(modelId) }
  const header = stringify(config, { lineWidth: 0 }).trimEnd()
  return `---\n${header}\n---\n\n${parsed.body.replace(/^\n+/, '')}`
}

export function generationPromptModelId(source) {
  try {
    return parseGenerationPrompt(source).modelId
  } catch {
    return null
  }
}
