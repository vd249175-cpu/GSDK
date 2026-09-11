import type { ElementPackageManifest } from './types'

const elementIdPattern = /^[a-z0-9][a-z0-9._-]*$/

export function parseElementManifest(manifestText: string): ElementPackageManifest {
  let value: unknown
  try {
    value = JSON.parse(manifestText)
  } catch {
    throw new Error('element.json 不是有效 JSON')
  }
  if (!value || typeof value !== 'object') throw new Error('element.json 必须是对象')
  const manifest = value as Record<string, unknown>
  if (typeof manifest.id !== 'string' || !elementIdPattern.test(manifest.id)) {
    throw new Error('Element id 只能包含小写字母、数字、点、下划线和短横线')
  }
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new Error('Element name 不能为空')
  }
  if (manifest.apiVersion !== 1) throw new Error('Element apiVersion 必须是 1')
  if (typeof manifest.entry !== 'string' || !manifest.entry.trim()) {
    throw new Error('Element entry 不能为空')
  }
  const entry = manifest.entry.replace(/\\/g, '/')
  if (entry !== 'element.ts') throw new Error('Element entry 必须是 element.ts')
  return { id: manifest.id, name: manifest.name.trim(), apiVersion: 1, entry }
}
