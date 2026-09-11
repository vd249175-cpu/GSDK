import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

const historyVersion = 1
const defaultLimit = 10

function normalizeEntry(value) {
  if (!value || typeof value !== 'object' || typeof value.path !== 'string') return null
  const path = resolve(value.path)
  const openedAt = typeof value.openedAt === 'number' && Number.isFinite(value.openedAt)
    ? value.openedAt
    : 0
  return {
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : basename(path),
    path,
    openedAt,
  }
}

function pathKey(path) {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

export class ProjectHistoryStore {
  constructor(filePath, limit = defaultLimit) {
    this.filePath = filePath
    this.limit = limit
    this.writeQueue = Promise.resolve()
  }

  async list() {
    await this.writeQueue
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (parsed?.version !== historyVersion || !Array.isArray(parsed.projects)) return []
      const seen = new Set()
      const candidates = parsed.projects
        .map(normalizeEntry)
        .filter((entry) => {
          if (!entry) return false
          const key = pathKey(entry.path)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .sort((left, right) => right.openedAt - left.openedAt)

      const existing = []
      let pruned = false
      for (const entry of candidates) {
        try {
          const entryStat = await stat(entry.path)
          if (entryStat.isDirectory()) {
            existing.push(entry)
          } else {
            pruned = true
          }
        } catch {
          pruned = true
        }
      }

      if (pruned) {
        await this.writeUnlocked(existing.slice(0, this.limit))
      }

      return existing.slice(0, this.limit)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
      return []
    }
  }

  record(projectPath, openedAt = Date.now()) {
    return this.enqueue(async () => {
      const path = resolve(projectPath)
      const current = await this.readUnlocked()
      const next = [
        { name: basename(path), path, openedAt },
        ...current.filter((entry) => pathKey(entry.path) !== pathKey(path)),
      ].slice(0, this.limit)
      await this.writeUnlocked(next)
      return next
    })
  }

  remove(projectPath) {
    return this.enqueue(async () => {
      const key = pathKey(projectPath)
      const next = (await this.readUnlocked()).filter((entry) => pathKey(entry.path) !== key)
      await this.writeUnlocked(next)
      return next
    })
  }

  enqueue(operation) {
    const queued = this.writeQueue.then(operation, operation)
    this.writeQueue = queued.then(() => undefined, () => undefined)
    return queued
  }

  async readUnlocked() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (parsed?.version !== historyVersion || !Array.isArray(parsed.projects)) return []
      return parsed.projects.map(normalizeEntry).filter(Boolean)
    } catch {
      return []
    }
  }

  async writeUnlocked(projects) {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, JSON.stringify({ version: historyVersion, projects }, null, 2), 'utf8')
    await rename(temporaryPath, this.filePath)
  }
}
