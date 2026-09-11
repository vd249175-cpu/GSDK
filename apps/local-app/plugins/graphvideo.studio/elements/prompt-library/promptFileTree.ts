import type { PromptLibraryEntry } from '@graphvideo/client-sdk'

export interface PromptFileRow {
  kind: 'directory' | 'file'
  name: string
  path: string
  depth: number
}

interface PromptDirectory {
  directories: Map<string, PromptDirectory>
  files: string[]
}

function createDirectory(): PromptDirectory {
  return { directories: new Map(), files: [] }
}

function ensureDirectory(root: PromptDirectory, parts: string[]) {
  let directory = root
  for (const part of parts) {
    const child = directory.directories.get(part) ?? createDirectory()
    directory.directories.set(part, child)
    directory = child
  }
  return directory
}

export function buildPromptFileRows(entries: PromptLibraryEntry[]): PromptFileRow[] {
  const root = createDirectory()
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    const normalizedPath = entry.path.replace(/\\/g, '/')
    const parts = normalizedPath.split('/').filter(Boolean)
    if (entry.kind === 'directory') ensureDirectory(root, parts)
    else {
      const fileName = parts.pop()
      if (fileName) ensureDirectory(root, parts).files.push(fileName)
    }
  }

  const rows: PromptFileRow[] = []
  function append(directory: PromptDirectory, parentPath: string, depth: number) {
    for (const [name, child] of [...directory.directories].sort(([left], [right]) => left.localeCompare(right))) {
      const path = parentPath ? `${parentPath}/${name}` : name
      rows.push({ kind: 'directory', name, path, depth })
      append(child, path, depth + 1)
    }
    for (const name of directory.files.sort()) {
      const path = parentPath ? `${parentPath}/${name}` : name
      rows.push({ kind: 'file', name, path, depth })
    }
  }
  append(root, '', 0)
  return rows
}

export function promptParentPath(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : ''
}

export function joinPromptPath(parentPath: string, name: string) {
  const normalizedParent = parentPath.replace(/\\/g, '/')
  return normalizedParent ? `${normalizedParent}/${name}` : name
}

export function promptEntryName(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').at(-1) ?? normalized
}

export function canMovePromptPath(sourcePath: string, targetDirectory: string) {
  const normSource = sourcePath.replace(/\\/g, '/')
  const normTarget = targetDirectory.replace(/\\/g, '/')
  if (!normSource || promptParentPath(normSource) === normTarget) return false
  return normTarget !== normSource && !normTarget.startsWith(`${normSource}/`)
}

export function promptMoveTarget(sourcePath: string, targetDirectory: string) {
  return joinPromptPath(targetDirectory, promptEntryName(sourcePath))
}

export function rebasePromptPath(path: string, sourcePath: string, targetPath: string) {
  const normPath = path.replace(/\\/g, '/')
  const normSource = sourcePath.replace(/\\/g, '/')
  const normTarget = targetPath.replace(/\\/g, '/')
  if (normPath === normSource) return normTarget
  return normPath.startsWith(`${normSource}/`) ? `${normTarget}${normPath.slice(normSource.length)}` : normPath
}

export function visiblePromptFileRows(rows: PromptFileRow[], collapsed: Set<string>) {
  return rows.filter((row) => {
    const parentPath = promptParentPath(row.path)
    if (!parentPath) return true
    const parts = parentPath.split('/')
    return !parts.some((_, index) => collapsed.has(parts.slice(0, index + 1).join('/')))
  })
}
