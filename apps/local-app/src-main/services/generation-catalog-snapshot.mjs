import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseGenerationModelPackage } from '../shared/generation-model-package.mjs'

const PACKAGE_FILES = ['model.json', 'execution.json', 'workflow.json']

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}

async function readPackage(directory, directoryName) {
  const directoryStat = await lstat(directory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error(`模型包 ${directoryName} 必须是普通目录`)
  const entries = await readdir(directory, { withFileTypes: true })
  const files = {}
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`模型包不允许符号链接: ${entry.name}`)
    if (!entry.isFile()) throw new Error(`模型包只允许普通 JSON 文件: ${entry.name}`)
    if (!PACKAGE_FILES.includes(entry.name)) throw new Error(`模型包包含不允许的文件: ${entry.name}`)
    files[entry.name] = await readFile(join(directory, entry.name), 'utf8')
  }
  return { files, snapshot: parseGenerationModelPackage({ directoryName, files }) }
}

async function readCatalog(catalogRoot) {
  const modelsRoot = resolve(catalogRoot, 'models')
  await mkdir(modelsRoot, { recursive: true })
  const entries = await readdir(modelsRoot, { withFileTypes: true })
  const packages = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.')) continue
    if (entry.isSymbolicLink()) throw new Error(`模型目录不允许符号链接: ${entry.name}`)
    if (!entry.isDirectory()) throw new Error(`models 目录只允许模型子目录: ${entry.name}`)
    packages.push(await readPackage(join(modelsRoot, entry.name), entry.name))
  }
  const ids = new Set()
  for (const entry of packages) {
    if (ids.has(entry.snapshot.model.id)) throw new Error(`生成模型 ID 重复: ${entry.snapshot.model.id}`)
    ids.add(entry.snapshot.model.id)
    for (const alias of entry.snapshot.model.aliases ?? []) {
      if (ids.has(alias)) throw new Error(`生成模型 ID 或 alias 重复: ${alias}`)
      ids.add(alias)
    }
  }
  const hash = createHash('sha256')
  for (const entry of packages) {
    hash.update(entry.snapshot.model.id)
    for (const name of PACKAGE_FILES) if (entry.files[name] !== undefined) hash.update(name).update(entry.files[name])
  }
  const models = packages.map((entry) => deepFreeze(entry.snapshot))
  return deepFreeze({ revision: hash.digest('hex'), models })
}

export class GenerationCatalogSnapshotStore {
  #snapshot = deepFreeze({ revision: '', models: [] })
  #byId = new Map()

  constructor(catalogRoot) {
    this.catalogRoot = resolve(catalogRoot)
    this.modelsRoot = resolve(this.catalogRoot, 'models')
  }

  get revision() {
    return this.#snapshot.revision
  }

  async load() {
    const next = await readCatalog(this.catalogRoot)
    this.#snapshot = next
    this.#byId = new Map(next.models.flatMap((model) => [
      [model.model.id, model],
      ...(model.model.aliases ?? []).map((alias) => [alias, model]),
    ]))
    return this.read()
  }

  read() {
    return structuredClone(this.#snapshot)
  }

  lookup(modelId) {
    const model = this.#byId.get(modelId)
    if (!model) throw new Error(`未找到 v2 生成模型: ${modelId}`)
    return model
  }

  select(modelIds) {
    const unique = [...new Set(modelIds.map((id) => this.#byId.get(id)?.model.id ?? id))]
    return {
      revision: this.#snapshot.revision,
      models: unique.map((id) => {
        return structuredClone(this.lookup(id))
      }),
    }
  }

  async importPackage(sourceDirectory, replaceExisting = false) {
    const source = resolve(sourceDirectory)
    const id = basename(source)
    await readPackage(source, id)
    await mkdir(this.modelsRoot, { recursive: true })
    const destination = join(this.modelsRoot, id)
    let existing = null
    try {
      existing = await lstat(destination)
      if (!replaceExisting) throw new Error(`模型 ${id} 已存在`)
      const current = this.#byId.get(id)
      if (current?.model.capabilities?.allowReplace !== true) throw new Error(`模型 ${id} 不允许替换`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const stagingRoot = await mkdtemp(join(this.modelsRoot, '.import-'))
    const temporary = join(stagingRoot, id)
    const backup = join(stagingRoot, 'previous')
    try {
      await cp(source, temporary, { recursive: true, errorOnExist: true, force: false })
      await readPackage(temporary, id)
      if (existing) await rename(destination, backup)
      await rename(temporary, destination)
      try {
        await this.load()
      } catch (error) {
        await rename(destination, temporary).catch(() => {})
        if (existing) await rename(backup, destination)
        throw error
      }
    } finally {
      await rm(stagingRoot, { recursive: true, force: true })
    }
    return this.select([id]).models[0]
  }

  async deletePackage(modelId) {
    const selected = this.#byId.get(modelId)
    if (!selected) throw new Error(`生成模型不存在: ${modelId}`)
    if (selected.model.capabilities?.allowDelete !== true) throw new Error(`模型 ${modelId} 不允许删除`)
    const destination = join(this.modelsRoot, modelId)
    const tombstone = join(this.modelsRoot, `.delete-${modelId}-${Date.now()}`)
    await rename(destination, tombstone)
    try {
      await this.load()
      await rm(tombstone, { recursive: true, force: true })
    } catch (error) {
      await rename(tombstone, destination)
      await this.load()
      throw error
    }
  }
}

export async function loadGenerationCatalogSnapshot(catalogRoot) {
  const store = new GenerationCatalogSnapshotStore(catalogRoot)
  await store.load()
  return store
}
