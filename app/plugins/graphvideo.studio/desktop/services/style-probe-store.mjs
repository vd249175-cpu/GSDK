import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveProjectPath } from './project-paths.mjs'

function sanitizeFileName(name) {
  const cleaned = String(name || '').trim().replace(/[/\\?%*:|"<>]/g, '-').replace(/\.+$/, '')
  return cleaned.endsWith('.md') ? cleaned : `${cleaned || 'target'}.md`
}

export function styleProbeDirectory(projectRoot) {
  return resolveProjectPath(projectRoot, 'style-probe')
}

export function projectMediaDirectory(projectRoot) {
  return resolveProjectPath(projectRoot, 'media')
}

export async function ensureStyleProbeLayout(projectRoot) {
  await Promise.all([
    mkdir(styleProbeDirectory(projectRoot), { recursive: true }),
    mkdir(projectMediaDirectory(projectRoot), { recursive: true }),
  ])
}

export async function listStyleProbeTargets(projectRoot) {
  await ensureStyleProbeLayout(projectRoot)
  const dir = styleProbeDirectory(projectRoot)
  const entries = await readdir(dir, { withFileTypes: true })
  const targets = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const filePath = join(dir, entry.name)
    try {
      const info = await stat(filePath)
      const content = await readFile(filePath, 'utf8')
      const titleMatch = content.match(/^#\s+(.+)$/m)
      const title = titleMatch ? titleMatch[1].trim() : entry.name.replace(/\.md$/, '')
      targets.push({
        fileName: entry.name,
        title,
        updatedAt: info.mtimeMs,
        size: info.size,
      })
    } catch {
      // ignore unreadable file
    }
  }

  return targets.sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function readStyleProbeTarget(projectRoot, fileName) {
  await ensureStyleProbeLayout(projectRoot)
  const safeName = sanitizeFileName(fileName)
  const filePath = resolveProjectPath(projectRoot, join('style-probe', safeName))
  return readFile(filePath, 'utf8')
}

export async function saveStyleProbeTarget(projectRoot, fileName, content) {
  await ensureStyleProbeLayout(projectRoot)
  const safeName = sanitizeFileName(fileName)
  const filePath = resolveProjectPath(projectRoot, join('style-probe', safeName))
  const tempPath = `${filePath}.tmp-${randomUUID()}`
  await writeFile(tempPath, typeof content === 'string' ? content : '', 'utf8')
  try {
    await rename(tempPath, filePath)
  } catch {
    await rm(filePath, { force: true }).catch(() => {})
    await rename(tempPath, filePath)
  }
}

export async function createStyleProbeTarget(projectRoot, fileName, title = '') {
  await ensureStyleProbeLayout(projectRoot)
  let safeName = sanitizeFileName(fileName || title || 'new-target')
  let filePath = resolveProjectPath(projectRoot, join('style-probe', safeName))

  try {
    await stat(filePath)
    // If exists, make unique
    safeName = sanitizeFileName(`${safeName.replace(/\.md$/, '')}-${randomUUID().slice(0, 4)}.md`)
    filePath = resolveProjectPath(projectRoot, join('style-probe', safeName))
  } catch {
    // doesn't exist, proceed
  }

  const defaultTitle = title || safeName.replace(/\.md$/, '')
  const initialContent = `# ${defaultTitle}

## 目标描述


## 参考多媒体


---

<prompt_queue>
</prompt_queue>
`
  await writeFile(filePath, initialContent, 'utf8')
  return { fileName: safeName, title: defaultTitle }
}

export async function deleteStyleProbeTarget(projectRoot, fileName) {
  await ensureStyleProbeLayout(projectRoot)
  const safeName = sanitizeFileName(fileName)
  const filePath = resolveProjectPath(projectRoot, join('style-probe', safeName))
  await rm(filePath, { force: true })
}

export async function importStyleProbeMedia(projectRoot, sourcePath, prefix = 'ref') {
  await ensureStyleProbeLayout(projectRoot)
  const ext = extname(sourcePath).toLowerCase() || '.png'
  const basePrefix = prefix === 'gen' ? 'gen' : 'ref'
  const targetName = `${basePrefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}${ext}`
  const destinationPath = resolveProjectPath(projectRoot, join('media', targetName))
  await copyFile(resolve(sourcePath), destinationPath)
  return `media/${targetName}`
}
