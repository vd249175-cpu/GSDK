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

function factoryNameList(value, field) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Plugin ${field} 必须是非空字符串数组`)
  }
  const names = value.map((item) => item.trim())
  if (new Set(names).size !== names.length) throw new Error(`Plugin ${field} 存在重复 ID`)
  return [...names]
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
  if (value.apiVersion !== 1 && value.apiVersion !== 2) throw new Error('Plugin apiVersion 必须是 1')
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
  if (value.apiVersion === 2) return parseV2Manifest(value, contributes)
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

function parseV2Manifest(value, contributes) {
  if (value.kind !== 'backend' && value.kind !== 'frontend') {
    throw new Error(`Plugin ${value.id} kind 必须是 backend 或 frontend`)
  }
  if (value.kind === 'backend') {
    if ('elements' in contributes || 'workspaces' in contributes) {
      throw new Error(`Plugin ${value.id} kind 与 contributes 不一致`)
    }
    return Object.freeze({
      id: value.id,
      name: value.name.trim(),
      version: value.version,
      apiVersion: 2,
      kind: 'backend',
      contributes: Object.freeze({
        backend: optionalEntry(contributes.backend, 'contributes.backend'),
        nodeFactories: Object.freeze(factoryNameList(contributes.nodeFactories, 'contributes.nodeFactories')),
        graphFactories: Object.freeze(factoryNameList(contributes.graphFactories, 'contributes.graphFactories')),
      }),
    })
  }
  if ('backend' in contributes || 'nodeFactories' in contributes || 'graphFactories' in contributes) {
    throw new Error(`Plugin ${value.id} kind 与 contributes 不一致`)
  }
  if (contributes.frontend !== undefined) optionalEntry(contributes.frontend, 'contributes.frontend')
  return Object.freeze({
    id: value.id,
    name: value.name.trim(),
    version: value.version,
    apiVersion: 2,
    kind: 'frontend',
    contributes: Object.freeze({
      frontend: contributes.frontend === undefined ? undefined : String(contributes.frontend).replace(/\\/g, '/'),
      elements: Object.freeze(stringList(contributes.elements, 'contributes.elements')),
      workspaces: Object.freeze(stringList(contributes.workspaces, 'contributes.workspaces')),
    }),
  })
}

export function defineStudioPluginManifest(manifest) {
  return parseStudioPluginManifest(manifest)
}

