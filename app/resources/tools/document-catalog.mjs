import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const AUXILIARY_DIRECTORIES = ['details', 'references']
const FIXED_ENTRY_FILES = new Set(['AGENTS.md', 'NAVIGATION.md'])
const IGNORED_DIRECTORIES = new Set(['.agents', '.git', 'node_modules'])

function portablePath(value) {
  return value.replaceAll('\\', '/')
}

function decodeMetadataValue(rawValue) {
  const value = rawValue.trim()
  if (!value) return null
  if (!value.startsWith('"')) return value
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'string' && parsed.trim() ? parsed.trim() : null
  } catch {
    return null
  }
}

export function parseDocumentMetadata(content) {
  const normalized = content.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) return null
  const closing = normalized.indexOf('\n---', 4)
  if (closing < 0) return null
  const fields = new Map()
  for (const line of normalized.slice(4, closing).split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match) fields.set(match[1], match[2])
  }
  const title = decodeMetadataValue(fields.get('title') ?? '')
  const description = decodeMetadataValue(fields.get('description') ?? '')
  return title && description ? { title, description } : null
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function markdownFilesAt(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
      files.push(...await markdownFilesAt(resolve(directory, entry.name)))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !FIXED_ENTRY_FILES.has(entry.name)) {
      files.push(resolve(directory, entry.name))
    }
  }
  return files
}

export async function catalogAgentDocuments(agentDirectory = process.cwd()) {
  const root = resolve(agentDirectory)
  if (!await isDirectory(root)) throw new Error(`Agent 文档目录不存在: ${root}`)
  const roots = []
  for (const name of AUXILIARY_DIRECTORIES) {
    const candidate = resolve(root, name)
    if (await isDirectory(candidate)) roots.push(candidate)
  }
  const filePaths = (await Promise.all((roots.length ? roots : [root]).map(markdownFilesAt))).flat()

  const parent = resolve(root, '..')
  if (await isDirectory(parent)) {
    try {
      const parentEntries = await readdir(parent, { withFileTypes: true })
      for (const entry of parentEntries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !FIXED_ENTRY_FILES.has(entry.name)) {
          filePaths.push(resolve(parent, entry.name))
        } else if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
          const subDir = resolve(parent, entry.name)
          let isAgentDir = false
          try {
            isAgentDir = (await stat(resolve(subDir, 'AGENTS.md'))).isFile()
          } catch {}
          if (!isAgentDir) {
            filePaths.push(...await markdownFilesAt(subDir))
          }
        }
      }
    } catch {}
  }

  const documents = []
  for (const filePath of filePaths) {
    const metadata = parseDocumentMetadata(await readFile(filePath, 'utf8'))
    if (metadata) documents.push({ path: portablePath(relative(root, filePath)), ...metadata })
  }
  return documents.sort((a, b) => a.path.localeCompare(b.path))
}
