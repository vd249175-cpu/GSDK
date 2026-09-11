const pluginIdPattern = /^[a-z0-9][a-z0-9.-]*$/
const relativeEntryPattern = /^(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+$/

function stringList(value, field) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !pluginIdPattern.test(item))) {
    throw new Error(`Plugin ${field} 必须是合法 ID 数组`)
  }
  if (new Set(value).size !== value.length) throw new Error(`Plugin ${field} 存在重复 ID`)
  return [...value]
}

function optionalEntry(value, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !relativeEntryPattern.test(value.replace(/\\/g, '/'))) {
    throw new Error(`Plugin ${field} 必须是包内相对路径`)
  }
  return value.replace(/\\/g, '/')
}

export function parseStudioPluginManifest(textOrValue) {
  let raw = textOrValue
  if (typeof textOrValue === 'string') {
    try {
      raw = JSON.parse(textOrValue)
    } catch {
      throw new Error('graphvideo.plugin.json 不是有效 JSON')
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('graphvideo.plugin.json 必须是对象')
  }
  const value = raw
  if (value.apiVersion !== 1) throw new Error('Plugin apiVersion 必须是 1')
  if (typeof value.id !== 'string' || !pluginIdPattern.test(value.id)) {
    throw new Error('Plugin id 只能包含小写字母、数字、点和短横线')
  }
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('Plugin name 不能为空')
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) {
    throw new Error('Plugin version 必须是 SemVer')
  }
  const contributes = value.contributes === undefined ? {} : value.contributes
  if (!contributes || typeof contributes !== 'object' || Array.isArray(contributes)) {
    throw new Error('Plugin contributes 必须是对象')
  }
  return Object.freeze({
    id: value.id,
    name: value.name.trim(),
    version: value.version,
    apiVersion: 1,
    contributes: Object.freeze({
      backend: optionalEntry(contributes.backend, 'contributes.backend'),
      elements: Object.freeze(stringList(contributes.elements, 'contributes.elements')),
      workspaces: Object.freeze(stringList(contributes.workspaces, 'contributes.workspaces')),
    }),
  })
}

export function defineStudioPluginManifest(manifest) {
  return parseStudioPluginManifest(manifest)
}

