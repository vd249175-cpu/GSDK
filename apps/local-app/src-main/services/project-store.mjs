import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { assertNodeId } from '../resources/shared/node-id.mjs'
import { resolveProjectDatabasePath, resolveProjectPath } from './project-paths.mjs'

const databaseRelativePath = join('.graphvideo', 'nodes.sqlite')
const initializedDatabasePaths = new Set()
export const minimalProjectMarkdown = `<project-structure>
# 项目
</project-structure>
`

const allowedExtensions = Object.freeze({
  text: new Set(['.md', '.markdown', '.txt']),
  image: new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']),
  video: new Set(['.mp4', '.webm', '.mov', '.mkv']),
  audio: new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']),
  style: new Set(['.md', '.markdown', '.txt']),
})

const mimeTypes = Object.freeze({
  '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.aac': 'audio/aac',
})

function nodeDirectory(projectRoot, id) {
  return resolveProjectPath(projectRoot, join('nodes', assertNodeId(id)))
}

function contentPath(projectRoot, id) {
  return join(nodeDirectory(projectRoot, id), 'content.md')
}

function usesTextPayload(type) {
  return type === 'text' || type === 'style'
}

function mediaNodePath(projectRoot, node) {
  return usesTextPayload(node.type) ? null : resolveProjectPath(projectRoot, join(nodeDirectory(projectRoot, node.id), 'media'))
}

async function atomicWrite(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`
  await writeFile(temporaryPath, value, 'utf8')
  try {
    await rename(temporaryPath, filePath)
  } catch (err) {
    if (process.platform === 'win32') {
      try {
        await rm(filePath, { force: true })
        await rename(temporaryPath, filePath)
      } catch {
        await writeFile(filePath, value, 'utf8')
        try { await rm(temporaryPath, { force: true }) } catch {}
      }
    } else {
      throw err
    }
  }
}

async function ensureLayout(projectRoot) {
  await Promise.all([
    mkdir(resolveProjectPath(projectRoot, '.graphvideo'), { recursive: true }),
    mkdir(resolveProjectPath(projectRoot, 'nodes'), { recursive: true }),
  ])
}

async function readOrCreateProjectMarkdown(projectRoot) {
  await ensureLayout(projectRoot)
  const database = openDatabase(projectRoot)
  try {
    const doc = database.prepare("SELECT markdown FROM project_documents WHERE id = 'project' LIMIT 1").get()
      || database.prepare("SELECT markdown FROM project_documents WHERE name = 'project.md' OR name = 'project' ORDER BY updated_at DESC LIMIT 1").get()
      || database.prepare("SELECT markdown FROM project_documents ORDER BY updated_at DESC LIMIT 1").get()
    if (doc && typeof doc.markdown === 'string' && doc.markdown.trim()) {
      return doc.markdown
    }
    // Legacy migration: if disk project.md exists, migrate into SQLite and clean up
    const projectPath = resolveProjectPath(projectRoot, 'project.md')
    try {
      if (statSync(projectPath).isFile()) {
        const legacyMarkdown = await readFile(projectPath, 'utf8')
        if (legacyMarkdown && legacyMarkdown.trim()) {
          database.prepare(`
            INSERT INTO project_documents (id, name, markdown, updated_at)
            VALUES ('project', 'project', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET markdown = excluded.markdown, updated_at = CURRENT_TIMESTAMP
          `).run(legacyMarkdown)
          try { await rm(projectPath, { force: true }) } catch {}
          return legacyMarkdown
        }
      }
    } catch {}

    database.prepare(`
      INSERT INTO project_documents (id, name, markdown, updated_at)
      VALUES ('project', 'project', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET markdown = excluded.markdown, updated_at = CURRENT_TIMESTAMP
    `).run(minimalProjectMarkdown)
    return minimalProjectMarkdown
  } finally {
    database.close()
  }
}

function openDatabase(projectRoot) {
  const databasePath = resolveProjectDatabasePath(projectRoot, databaseRelativePath)
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA foreign_keys = ON')
  if (initializedDatabasePaths.has(databasePath)) return database
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('text', 'image', 'video', 'audio', 'style')),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      prompt TEXT,
      history_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS nodes_active_idx ON nodes(active);
    CREATE TABLE IF NOT EXISTS project_documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      markdown TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS project_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  // 确保旧表升级增加 content 字段
  try {
    const cols = database.prepare("PRAGMA table_info(nodes)").all().map((c) => c.name)
    if (!cols.includes('content')) {
      database.exec("ALTER TABLE nodes ADD COLUMN content TEXT NOT NULL DEFAULT ''")
    }
  } catch {}
  initializedDatabasePaths.add(databasePath)
  return database
}

export async function persistGraphMetadata(projectRoot, records) {
  if (!Array.isArray(records)) throw new Error('graph metadata records 必须是数组')
  const ids = new Set()
  for (const record of records) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !record.id.trim()) {
      throw new Error('graph metadata record 缺少 id')
    }
    if (ids.has(record.id)) throw new Error(`graph metadata record id 重复: ${record.id}`)
    ids.add(record.id)
  }
  await ensureLayout(projectRoot)
  const database = openDatabase(projectRoot)
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS graph_metadata (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    const upsert = database.prepare(`
      INSERT INTO graph_metadata (id, payload_json, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = CURRENT_TIMESTAMP
    `)
    const updateNode = database.prepare(`
      UPDATE nodes SET
        title = CASE WHEN ? IS NOT NULL THEN ? ELSE title END,
        description = CASE WHEN ? IS NOT NULL THEN ? ELSE description END,
        content = CASE WHEN ? IS NOT NULL THEN ? ELSE content END,
        prompt = CASE WHEN ? IS NOT NULL THEN ? ELSE prompt END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    const updateHistory = database.prepare(`
      UPDATE nodes SET
        history_json = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) {
        upsert.run(record.id, JSON.stringify(record))
        const hasTextUpdates = record.title !== undefined
          || record.description !== undefined
          || record.content !== undefined
          || record.prompt !== undefined
        if (hasTextUpdates) {
          updateNode.run(
            record.title !== undefined ? record.title : null,
            record.title !== undefined ? record.title : null,
            record.description !== undefined ? record.description : null,
            record.description !== undefined ? record.description : null,
            record.content !== undefined ? record.content : null,
            record.content !== undefined ? record.content : null,
            record.prompt !== undefined ? record.prompt : null,
            record.prompt !== undefined ? record.prompt : null,
            record.id,
          )
        }
        if (Array.isArray(record.history)) {
          updateHistory.run(JSON.stringify(normalizeHistory(record)), record.id)
        }
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  } finally {
    database.close()
  }
  const dbFilePath = resolveProjectDatabasePath(projectRoot, databaseRelativePath)
  const file = await stat(dbFilePath)
  const canonical = [...records]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => JSON.stringify(record))
    .join('\n')
  return {
    dbFilePath: databaseRelativePath.replaceAll('\\', '/'),
    persistedRecordCount: records.length,
    byteLength: file.size,
    contentRef: `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
  }
}

function parseHistory(value, nodeType) {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    const versions = parsed.flatMap((item) => {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string'
        || typeof item.relativePath !== 'string') return []
      return [{
        id: item.id,
        label: typeof item.label === 'string' ? item.label : basename(item.relativePath),
        relativePath: item.relativePath,
        mimeType: typeof item.mimeType === 'string'
          ? item.mimeType
          : mimeTypes[extname(item.relativePath).toLowerCase()] ?? 'application/octet-stream',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        source: item.source === 'upload' || item.source === 'edit' ? item.source : 'generated',
        current: item.current === true,
      }]
    })
    let currentIndex = -1
    for (let index = 0; index < versions.length; index += 1) {
      if (versions[index].current) currentIndex = index
    }
    if (currentIndex < 0 && versions.length > 0) currentIndex = versions.length - 1
    return versions.map((version, index) => ({
      ...version,
      current: index === currentIndex,
      mimeType: nodeType === 'text' && !version.mimeType.startsWith('text/')
      ? 'text/plain'
      : version.mimeType,
    }))
  } catch {
    return []
  }
}

function normalizeHistory(node) {
  return parseHistory(JSON.stringify(node.history ?? []), node.type)
}

function projectRelativePath(projectRoot, filePath) {
  return relative(projectRoot, filePath).split(sep).join('/')
}

function hydrateNode(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description ?? '',
    ...(usesTextPayload(row.type)
      ? { content: row.content ?? '', history: parseHistory(row.history_json, row.type) }
      : { prompt: row.prompt ?? '', history: parseHistory(row.history_json, row.type) }),
  }
}

async function loadNodes(projectRoot, active = 1) {
  const database = openDatabase(projectRoot)
  try {
    const rows = database.prepare(`
      SELECT id, type, title, description, content, prompt, history_json
      FROM nodes WHERE active = ? ORDER BY rowid
    `).all(active)
    return rows.map((row) => hydrateNode(row))
  } finally {
    database.close()
  }
}

async function hasStoredPayload(projectRoot, node) {
  if (usesTextPayload(node.type)) {
    return (node.content ?? '').trim().length > 0
  }
  if ((node.prompt ?? '').trim().length > 0) return true
  const history = parseHistory(node.history_json, node.type)
  if (history.length > 0) return true
  const directory = mediaNodePath(projectRoot, node)
  if (!directory) return false
  try {
    return (await readdir(directory)).length > 0
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

function upsertNode(database, node) {
  database.prepare(`
    INSERT INTO nodes (id, type, title, description, content, prompt, history_json, active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      title = excluded.title,
      description = excluded.description,
      content = excluded.content,
      prompt = excluded.prompt,
      history_json = excluded.history_json,
      active = 1,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    node.id,
    node.type,
    node.title,
    node.description ?? '',
    node.content ?? '',
    usesTextPayload(node.type) ? null : node.prompt ?? '',
    JSON.stringify(normalizeHistory(node)),
  )
}

function prepareNodeForStorage(node) {
  assertNodeId(node.id)
  return { ...node, history: normalizeHistory(node) }
}

export async function openLocalProject(projectRoot) {
  let projectStat
  try {
    projectStat = await stat(projectRoot)
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      const missingError = new Error(`项目目录不存在: ${projectRoot}`)
      missingError.code = 'ENOENT'
      throw missingError
    }
    throw error
  }
  if (!projectStat.isDirectory()) {
    const notDirError = new Error(`项目路径不是目录: ${projectRoot}`)
    notDirError.code = 'ENOTDIR'
    throw notDirError
  }
  const markdown = await readOrCreateProjectMarkdown(projectRoot)
  await ensureLayout(projectRoot)
  const nodes = await loadNodes(projectRoot)
  const retainedNodes = await loadNodes(projectRoot, 0)
  return { name: basename(projectRoot), path: projectRoot, markdown, nodes, retainedNodes }
}

export async function saveProjectSnapshot(projectRoot, { markdown, nodes }) {
  await ensureLayout(projectRoot)
  const readDatabase = openDatabase(projectRoot)
  let existingRows
  try {
    existingRows = readDatabase.prepare(`
      SELECT id, type, title, description, content, prompt, history_json, active FROM nodes
    `).all()
  } finally {
    readDatabase.close()
  }
  const existingById = new Map(existingRows.map((row) => [row.id, row]))
  for (const node of nodes) {
    const existing = existingById.get(node.id)
    if (existing && existing.active === 0 && (existing.type !== node.type || existing.title !== node.title)) {
      throw new Error(`ID “${node.id}” 已被保留节点 “${existing.title}” 占用`)
    }
  }

  const incomingIds = new Set(nodes.map((node) => node.id))
  const missingRows = existingRows.filter((row) => !incomingIds.has(row.id))
  const retainedIds = new Set()
  for (const row of missingRows) {
    if (await hasStoredPayload(projectRoot, row)) retainedIds.add(row.id)
  }

  const storedNodes = nodes.map((node) => prepareNodeForStorage(node))
  const database = openDatabase(projectRoot)
  try {
    database.exec('BEGIN IMMEDIATE')
    database.exec('UPDATE nodes SET active = 0')
    const deleteNode = database.prepare('DELETE FROM nodes WHERE id = ?')
    missingRows.forEach((row) => {
      if (!retainedIds.has(row.id)) deleteNode.run(row.id)
    })
    storedNodes.forEach((node) => upsertNode(database, node))
    if (typeof markdown === 'string') {
      database.prepare(`
        INSERT INTO project_documents (id, name, markdown, updated_at)
        VALUES ('project', 'project', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET markdown = excluded.markdown, updated_at = CURRENT_TIMESTAMP
      `).run(markdown)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  } finally {
    database.close()
  }
  return { nodes: storedNodes, retainedNodes: await loadNodes(projectRoot, 0) }
}

export async function saveProjectMarkdown(projectRoot, markdown) {
  await ensureLayout(projectRoot)
  const database = openDatabase(projectRoot)
  try {
    database.prepare(`
      INSERT INTO project_documents (id, name, markdown, updated_at)
      VALUES ('project', 'project', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET markdown = excluded.markdown, updated_at = CURRENT_TIMESTAMP
    `).run(markdown ?? '')
  } finally {
    database.close()
  }
}

export async function saveProjectStructure(projectRoot, { markdown, nodes }) {
  await ensureLayout(projectRoot)
  const readDatabase = openDatabase(projectRoot)
  let existingRows
  try {
    existingRows = readDatabase.prepare(`
      SELECT id, type, title, description, content, prompt, history_json, active FROM nodes
    `).all()
  } finally {
    readDatabase.close()
  }
  const existingById = new Map(existingRows.map((row) => [row.id, row]))
  const incomingIds = new Set(nodes.map((node) => node.id))
  const missingRows = existingRows.filter((row) => row.active === 1 && !incomingIds.has(row.id))
  const retainedIds = new Set()
  for (const row of missingRows) {
    if (await hasStoredPayload(projectRoot, row)) retainedIds.add(row.id)
  }
  for (const node of nodes) {
    assertNodeId(node.id)
    const existing = existingById.get(node.id)
    if (existing && existing.active === 0 && (existing.type !== node.type || existing.title !== node.title)) {
      throw new Error(`ID “${node.id}” 已被保留节点 “${existing.title}” 占用`)
    }
  }
  const changedNodes = nodes.filter((node) => {
    const existing = existingById.get(node.id)
    return !existing || existing.active !== 1
      || existing.type !== node.type || existing.title !== node.title
  })

  const database = openDatabase(projectRoot)
  try {
    database.exec('BEGIN IMMEDIATE')
    const deleteNode = database.prepare('DELETE FROM nodes WHERE id = ?')
    const retainNode = database.prepare('UPDATE nodes SET active = 0 WHERE id = ?')
    missingRows.forEach((row) => {
      if (retainedIds.has(row.id)) retainNode.run(row.id)
      else deleteNode.run(row.id)
    })
    changedNodes.forEach((node) => upsertNode(database, prepareNodeForStorage(node)))
    if (typeof markdown === 'string') {
      database.prepare(`
        INSERT INTO project_documents (id, name, markdown, updated_at)
        VALUES ('project', 'project', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET markdown = excluded.markdown, updated_at = CURRENT_TIMESTAMP
      `).run(markdown)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  } finally {
    database.close()
  }
  return { nodes, retainedNodes: await loadNodes(projectRoot, 0) }
}

export async function saveProjectNode(projectRoot, node) {
  await ensureLayout(projectRoot)
  const storedNode = prepareNodeForStorage(node)
  const database = openDatabase(projectRoot)
  try {
    upsertNode(database, storedNode)
  } finally {
    database.close()
  }
  return storedNode
}

export async function renameRetainedNode(projectRoot, oldTitleOrId, newTitle) {
  await ensureLayout(projectRoot)
  const database = openDatabase(projectRoot)
  try {
    const row = database.prepare(`
      SELECT id, title, type FROM nodes WHERE (id = ? OR title = ?) AND active = 0 LIMIT 1
    `).get(oldTitleOrId, oldTitleOrId)
    if (!row) throw new Error(`未找到历史保留节点：“${oldTitleOrId}”`)
    database.prepare('UPDATE nodes SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newTitle, row.id)
    return { id: row.id, oldTitle: row.title, newTitle, type: row.type }
  } finally {
    database.close()
  }
}

export async function getProjectNode(projectRoot, nodeId) {
  const database = openDatabase(projectRoot)
  let row
  try {
    row = database.prepare(`
      SELECT id, type, title, description, content, prompt, history_json
      FROM nodes WHERE id = ? AND active = 1
    `).get(nodeId)
  } finally {
    database.close()
  }
  if (!row) throw new Error('当前项目中不存在该节点')
  return hydrateNode(row)
}

export async function importProjectNodeVersion(projectRoot, nodeId, sourcePath) {
  const node = await getProjectNode(projectRoot, nodeId)
  const extension = extname(sourcePath).toLowerCase()
  if (!allowedExtensions[node.type]?.has(extension)) {
    throw new Error(`所选文件不适用于 ${node.type} 节点`)
  }
  await ensureLayout(projectRoot)
  const versionId = `v-${Date.now()}-${randomUUID().slice(0, 8)}`
  const payloadDirectory = resolveProjectPath(projectRoot, join(nodeDirectory(projectRoot, node.id), usesTextPayload(node.type) ? 'versions' : 'media'))
  await mkdir(payloadDirectory, { recursive: true })
  const destinationPath = resolveProjectPath(projectRoot, join(payloadDirectory, `${versionId}${extension}`))
  await copyFile(sourcePath, destinationPath)

  const history = normalizeHistory(node).map((version) => ({ ...version, current: false }))
  history.push({
    id: versionId,
    label: basename(sourcePath),
    relativePath: projectRelativePath(projectRoot, destinationPath),
    mimeType: mimeTypes[extension] ?? 'application/octet-stream',
    createdAt: new Date().toISOString(),
    source: 'upload',
    current: true,
  })
  const nextNode = {
    ...node,
    ...(usesTextPayload(node.type) ? { content: await readFile(sourcePath, 'utf8') } : {}),
    history,
  }
  return saveProjectNode(projectRoot, nextNode)
}

export async function writeProjectNodeMediaBuffer(projectRoot, nodeId, filename, buffer) {
  const node = await getProjectNode(projectRoot, nodeId)
  const extension = extname(filename).toLowerCase()
  if (!allowedExtensions[node.type]?.has(extension)) {
    throw new Error(`所选文件不适用于 ${node.type} 节点`)
  }
  await ensureLayout(projectRoot)
  const versionId = `v-${Date.now()}-${randomUUID().slice(0, 8)}`
  const payloadDirectory = resolveProjectPath(projectRoot, join(nodeDirectory(projectRoot, node.id), 'media'))
  await mkdir(payloadDirectory, { recursive: true })
  const destinationPath = resolveProjectPath(projectRoot, join(payloadDirectory, `${versionId}${extension}`))
  await writeFile(destinationPath, buffer, { flag: 'wx' })

  const history = normalizeHistory(node).map((version) => ({ ...version, current: false }))
  history.push({
    id: versionId,
    label: filename,
    relativePath: projectRelativePath(projectRoot, destinationPath),
    mimeType: mimeTypes[extension] ?? 'application/octet-stream',
    createdAt: new Date().toISOString(),
    source: 'generated',
    current: true,
  })
  const nextNode = {
    ...node,
    history,
  }
  return saveProjectNode(projectRoot, nextNode)
}

export async function promoteProjectNodeVersion(projectRoot, nodeId, versionId) {
  const node = await getProjectNode(projectRoot, nodeId)
  const history = normalizeHistory(node)
  const selected = history.find((version) => version.id === versionId)
  if (!selected) throw new Error('找不到要提升的节点版本')
  const versionPath = resolveProjectPath(projectRoot, selected.relativePath)
  await stat(versionPath)
  const nextNode = {
    ...node,
    ...(usesTextPayload(node.type) ? { content: await readFile(versionPath, 'utf8') } : {}),
    history: history.map((version) => ({ ...version, current: version.id === versionId })),
  }
  return saveProjectNode(projectRoot, nextNode)
}

export async function resolveProjectNodeVersionPath(projectRoot, nodeId, versionId) {
  const database = openDatabase(projectRoot)
  let row
  try {
    row = database.prepare('SELECT type, history_json FROM nodes WHERE id = ?').get(nodeId)
  } finally {
    database.close()
  }
  if (!row) throw new Error('节点不存在')
  const version = parseHistory(row.history_json, row.type).find((item) => item.id === versionId)
  if (!version) throw new Error('节点版本不存在')
  const filePath = resolveProjectPath(projectRoot, version.relativePath)
  await stat(filePath)
  return filePath
}

export function resolveProjectNodeVersionPathSync(projectRoot, nodeId, versionId) {
  const database = openDatabase(projectRoot)
  let row
  try {
    row = database.prepare('SELECT type, history_json FROM nodes WHERE id = ?').get(nodeId)
  } finally {
    database.close()
  }
  if (!row) throw new Error('节点不存在')
  const version = parseHistory(row.history_json, row.type).find((item) => item.id === versionId)
  if (!version) throw new Error('节点版本不存在')
  const filePath = resolveProjectPath(projectRoot, version.relativePath)
  if (!statSync(filePath).isFile()) throw new Error('节点版本不是文件')
  return filePath
}

export const projectImportFilters = Object.freeze({
  text: [{ name: '文本', extensions: ['md', 'markdown', 'txt'] }],
  image: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }],
  video: [{ name: '视频', extensions: ['mp4', 'webm', 'mov', 'mkv'] }],
  audio: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'] }],
  style: [{ name: '风格文本', extensions: ['md', 'markdown', 'txt'] }],
})

export const projectLayout = Object.freeze({
  databaseRelativePath,
  nodesDirectory: 'nodes',
})
