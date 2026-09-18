import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'

async function directoriesAt(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

export async function ensureGitBoundary(directory) {
  try {
    const gitPath = join(directory, '.git')
    await Promise.all([
      mkdir(join(gitPath, 'objects'), { recursive: true }),
      mkdir(join(gitPath, 'refs', 'heads'), { recursive: true }),
    ])
    try {
      await writeFile(join(gitPath, 'HEAD'), 'ref: refs/heads/main\n', { flag: 'wx' })
      await writeFile(
        join(gitPath, 'config'),
        '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n',
        { flag: 'wx' },
      )
    } catch {
      // Non-fatal if config files already exist
    }
  } catch {
    // Non-fatal if read-only
  }
}

function pathInside(root, ...parts) {
  const rootPath = resolve(root)
  const targetPath = resolve(rootPath, ...parts)
  const pathFromRoot = relative(rootPath, targetPath)
  if (pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..')) {
    return targetPath
  }
  throw new Error('路径超出允许目录')
}

export async function discoverAgentTemplates(templatesRoot) {
  const templates = []
  for (const templateId of await directoriesAt(templatesRoot)) {
    const agentsRoot = pathInside(templatesRoot, templateId, 'agents')
    const agents = []
    for (const agentId of await directoriesAt(agentsRoot)) {
      const agentDirectory = pathInside(agentsRoot, agentId)
      try {
        await readFile(pathInside(agentDirectory, 'AGENTS.md'), 'utf8')
        await ensureGitBoundary(agentDirectory)
        agents.push({ id: agentId, name: agentId })
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
      }
    }
    if (agents.length > 0) templates.push({ id: templateId, name: templateId, agents })
  }
  return templates
}

export async function resolveAgentDirectory(templatesRoot, templateId, agentId) {
  const templates = await discoverAgentTemplates(templatesRoot)
  const template = templates.find((item) => item.id === templateId)
  if (!template?.agents.some((agent) => agent.id === agentId)) throw new Error('Agent 不存在')
  const agentDirectory = pathInside(templatesRoot, templateId, 'agents', agentId)
  await ensureGitBoundary(agentDirectory)
  return agentDirectory
}

function normalizePromptPath(relativePath) {
  if (typeof relativePath !== 'string') throw new Error('提示词路径无效')
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('提示词路径无效')
  }
  return normalized
}

async function promptEntriesAt(root, directory = root) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
  const items = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = pathInside(directory, entry.name)
    const relativePath = relative(root, entryPath).split(sep).join('/')
    if (entry.isDirectory()) {
      items.push({ kind: 'directory', path: relativePath })
      items.push(...await promptEntriesAt(root, entryPath))
    }
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.xml') {
      items.push({ kind: 'file', path: relativePath })
    }
  }
  return items
}

export function resolvePromptEntry(promptLibraryRoot, relativePath) {
  return pathInside(promptLibraryRoot, ...normalizePromptPath(relativePath).split('/'))
}

export function resolvePromptFile(promptLibraryRoot, relativePath) {
  const normalized = normalizePromptPath(relativePath)
  if (extname(normalized).toLowerCase() !== '.xml') {
    throw new Error('提示词文件必须是 XML')
  }
  return resolvePromptEntry(promptLibraryRoot, normalized)
}

export async function listPromptEntries(promptLibraryRoot) {
  return promptEntriesAt(resolve(promptLibraryRoot))
}

export async function readPromptFile(promptLibraryRoot, relativePath) {
  return readFile(resolvePromptFile(promptLibraryRoot, relativePath), 'utf8')
}

export async function savePromptFile(promptLibraryRoot, relativePath, content) {
  if (typeof content !== 'string') throw new Error('提示词内容无效')
  await writeFile(resolvePromptFile(promptLibraryRoot, relativePath), content, 'utf8')
}

export async function createPromptFile(promptLibraryRoot, relativePath, content) {
  if (typeof content !== 'string') throw new Error('提示词内容无效')
  const filePath = resolvePromptFile(promptLibraryRoot, relativePath)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' })
}

export async function createPromptDirectory(promptLibraryRoot, relativePath) {
  const directoryPath = resolvePromptEntry(promptLibraryRoot, relativePath)
  await mkdir(dirname(directoryPath), { recursive: true })
  await mkdir(directoryPath)
}

export async function renamePromptEntry(promptLibraryRoot, sourcePath, targetPath) {
  const source = resolvePromptEntry(promptLibraryRoot, sourcePath)
  const sourceInfo = await stat(source)
  const target = sourceInfo.isDirectory()
    ? resolvePromptEntry(promptLibraryRoot, targetPath)
    : resolvePromptFile(promptLibraryRoot, targetPath)
  if (source === target) return
  if (sourceInfo.isDirectory() && target.startsWith(`${source}${sep}`)) {
    throw new Error('目录不能移动到自身内部')
  }
  await rename(source, target)
}

export async function deletePromptEntry(promptLibraryRoot, relativePath) {
  const entryPath = resolvePromptEntry(promptLibraryRoot, relativePath)
  const entryInfo = await stat(entryPath)
  await rm(entryPath, { recursive: entryInfo.isDirectory(), force: false })
}
