import { parseGenerationPrompt } from './generation-prompt.mjs'

const idCharacter = /[\p{L}\p{N}_-]/u
const prefixByType = { text: '$', image: '@', video: '%', audio: '~', style: '&' }
const frameReferenceKeys = new Set(['firstFrame', 'first_frame', 'lastFrame', 'last_frame'])
const scalarReferenceKeys = new Set([
  'voiceReference', 'voice_id', 'voiceId',
  'ref_image', 'ref_audio', 'character_image',
])
const listReferenceKeys = new Set([
  'referenceImages', 'referenceVideos', 'referenceAudios', 'references',
])

function isBoundary(value) {
  return value === undefined || !idCharacter.test(value)
}

function firstPatternIndex(prompt, pattern, needBoundary) {
  if (!pattern) return -1
  let start = prompt.indexOf(pattern)
  while (start >= 0) {
    const end = start + pattern.length
    if (!needBoundary || (isBoundary(prompt[start - 1]) && isBoundary(prompt[end]))) return start
    start = prompt.indexOf(pattern, end)
  }
  return -1
}

function firstMentionIndex(prompt, node) {
  const prefix = prefixByType[node.type] ?? ''
  const patterns = []
  if (node.title) {
    if (prefix) {
      patterns.push([`[${prefix}${node.title}]`, false])
      patterns.push([`${prefix}${node.title}`, true])
      patterns.push([`[${prefix}${node.title}:${node.id}]`, false])
    }
    patterns.push([`[${node.title}]`, false])
  }
  patterns.push([`[${node.id}]`, false], [node.id, true])
  const found = patterns
    .map(([pattern, needBoundary]) => firstPatternIndex(prompt, pattern, needBoundary))
    .filter((index) => index >= 0)
  return found.length > 0 ? Math.min(...found) : -1
}

function explicitReferenceIds(config) {
  const ids = []
  const firstFrame = config.firstFrame ?? config.first_frame
  const lastFrame = config.lastFrame ?? config.last_frame
  if (typeof firstFrame === 'string') ids.push(firstFrame)
  if (typeof lastFrame === 'string') ids.push(lastFrame)
  for (const [key, value] of Object.entries(config)) {
    if (frameReferenceKeys.has(key)) continue
    if (scalarReferenceKeys.has(key) && typeof value === 'string') ids.push(value)
    if (listReferenceKeys.has(key) && Array.isArray(value)) {
      ids.push(...value.filter((item) => typeof item === 'string'))
    }
  }
  return ids
}

/**
 * Canonical dependency order used by preview, launch and prompt/media copy:
 * first textual occurrence, then explicit YAML-only references, then structural-only dependencies.
 */
export function orderedGenerationReferenceIds({
  prompt = '', nodes = [], targetNodeId, structuralIds = [],
}) {
  let promptBody = prompt
  let config = {}
  try {
    const parsed = parseGenerationPrompt(prompt)
    promptBody = parsed.body
    config = parsed.config
  } catch {}
  const candidates = nodes.filter((node) => node?.id && node.id !== targetNodeId)
  const knownIds = new Set(candidates.map((node) => node.id))
  const promptReferences = candidates
    .map((node, sourceOrder) => ({ id: node.id, sourceOrder, index: firstMentionIndex(promptBody, node) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index || left.sourceOrder - right.sourceOrder)
    .map((entry) => entry.id)
  const ordered = []
  const added = new Set()
  const add = (id) => {
    if (!knownIds.has(id) || added.has(id)) return
    added.add(id)
    ordered.push(id)
  }
  promptReferences.forEach(add)
  explicitReferenceIds(config).forEach(add)
  structuralIds.forEach(add)
  return ordered
}
