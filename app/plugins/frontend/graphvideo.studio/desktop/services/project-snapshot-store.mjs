import { randomUUID } from 'node:crypto'
import { DatabaseSync, backup } from 'node:sqlite'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveProjectDatabasePath, resolveProjectPath } from './project-paths.mjs'

const catalogVersion = 1
const databaseRelativePath = join('.graphvideo', 'nodes.sqlite')
const snapshotsRelativeDirectory = join('.graphvideo', 'snapshots')
const catalogFileName = 'catalog.json'
const projectOperations = new Map()
const snapshotFileNamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.sqlite$/i

function isoNow() {
  return new Date().toISOString()
}

function snapshotDirectory(projectRoot) {
  return resolveProjectPath(projectRoot, snapshotsRelativeDirectory)
}

function catalogPath(projectRoot) {
  return resolveProjectPath(projectRoot, join(snapshotsRelativeDirectory, catalogFileName))
}

function databasePath(projectRoot) {
  return resolveProjectDatabasePath(projectRoot, databaseRelativePath)
}

function snapshotPath(projectRoot, fileName) {
  if (typeof fileName !== 'string' || !snapshotFileNamePattern.test(fileName)) {
    throw new Error('快照文件名无效')
  }
  return resolveProjectDatabasePath(projectRoot, join(snapshotsRelativeDirectory, fileName))
}

function defaultCatalog() {
  const createdAt = isoNow()
  return {
    version: catalogVersion,
    activeBranchId: 'main',
    branches: [{
      id: 'main',
      name: '主分支',
      createdAt,
      sourceSnapshotId: null,
      headSnapshotId: null,
    }],
    snapshots: [],
  }
}

function normalizedLabel(value, fallback) {
  const label = typeof value === 'string' ? value.trim() : ''
  return (label || fallback).slice(0, 80)
}

function normalizedCatalog(value) {
  if (!value || typeof value !== 'object' || value.version !== catalogVersion) {
    return defaultCatalog()
  }
  const branches = Array.isArray(value.branches)
    ? value.branches.filter((branch) => branch && typeof branch.id === 'string'
      && typeof branch.name === 'string')
    : []
  const snapshots = Array.isArray(value.snapshots)
    ? value.snapshots.filter((snapshot) => snapshot && typeof snapshot.id === 'string'
      && typeof snapshot.branchId === 'string' && typeof snapshot.fileName === 'string')
    : []
  for (const snapshot of snapshots) {
    if (!snapshotFileNamePattern.test(snapshot.fileName)) throw new Error('快照文件名无效')
  }
  if (!branches.some((branch) => branch.id === value.activeBranchId)) return defaultCatalog()
  return {
    version: catalogVersion,
    activeBranchId: value.activeBranchId,
    branches,
    snapshots,
  }
}

async function readCatalog(projectRoot) {
  await mkdir(snapshotDirectory(projectRoot), { recursive: true })
  try {
    return normalizedCatalog(JSON.parse(await readFile(catalogPath(projectRoot), 'utf8')))
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return defaultCatalog()
    throw new Error(`项目快照目录损坏: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
}

async function writeCatalog(projectRoot, catalog) {
  const targetPath = catalogPath(projectRoot)
  const temporaryPath = `${targetPath}.tmp-${randomUUID()}`
  await mkdir(snapshotDirectory(projectRoot), { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  try {
    await rename(temporaryPath, targetPath)
  } catch (error) {
    if (process.platform !== 'win32') throw error
    await rm(targetPath, { force: true })
    await rename(temporaryPath, targetPath)
  }
}

async function withProjectLock(projectRoot, operation) {
  const previous = projectOperations.get(projectRoot) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  projectOperations.set(projectRoot, current)
  try {
    return await current
  } finally {
    if (projectOperations.get(projectRoot) === current) projectOperations.delete(projectRoot)
  }
}

async function backupDatabase(sourcePath, destinationPath) {
  const source = new DatabaseSync(sourcePath, { readOnly: true })
  try {
    await backup(source, destinationPath)
  } finally {
    source.close()
  }
}

function publicCatalog(catalog) {
  return {
    activeBranchId: catalog.activeBranchId,
    branches: catalog.branches.map((branch) => ({ ...branch })),
    snapshots: catalog.snapshots.map((snapshot) => ({
      id: snapshot.id,
      branchId: snapshot.branchId,
      parentId: snapshot.parentId,
      label: snapshot.label,
      createdAt: snapshot.createdAt,
      sizeBytes: snapshot.sizeBytes,
      kind: snapshot.kind,
    })),
  }
}

async function createSnapshotRecord(projectRoot, catalog, { label, kind }) {
  const activeBranch = catalog.branches.find((branch) => branch.id === catalog.activeBranchId)
  if (!activeBranch) throw new Error('当前项目快照分支不存在')

  const sourcePath = databasePath(projectRoot)
  await stat(sourcePath)
  const id = randomUUID()
  const fileName = `${id}.sqlite`
  const destinationPath = snapshotPath(projectRoot, fileName)
  await backupDatabase(sourcePath, destinationPath)
  const snapshotStat = await stat(destinationPath)
  const createdAt = isoNow()
  const record = {
    id,
    branchId: activeBranch.id,
    parentId: activeBranch.headSnapshotId,
    label: normalizedLabel(label, kind === 'recovery' ? '切换前保护快照' : '项目快照'),
    createdAt,
    sizeBytes: snapshotStat.size,
    kind,
    fileName,
  }
  return {
    record,
    catalog: {
      ...catalog,
      branches: catalog.branches.map((branch) => branch.id === activeBranch.id
        ? { ...branch, headSnapshotId: id }
        : branch),
      snapshots: [...catalog.snapshots, record],
    },
  }
}

export async function listProjectSnapshots(projectRoot) {
  return withProjectLock(projectRoot, async () => publicCatalog(await readCatalog(projectRoot)))
}

export async function createProjectSnapshot(projectRoot, label) {
  return withProjectLock(projectRoot, async () => {
    const current = await readCatalog(projectRoot)
    const { catalog } = await createSnapshotRecord(projectRoot, current, {
      label,
      kind: 'manual',
    })
    await writeCatalog(projectRoot, catalog)
    return publicCatalog(catalog)
  })
}

export async function branchProjectSnapshot(projectRoot, snapshotId, requestedBranchName) {
  return withProjectLock(projectRoot, async () => {
    const current = await readCatalog(projectRoot)
    const selectedSnapshot = current.snapshots.find((snapshot) => snapshot.id === snapshotId)
    if (!selectedSnapshot) throw new Error('选择的项目快照不存在')
    const branchName = normalizedLabel(requestedBranchName, `分支 ${current.branches.length}`)
    if (current.branches.some((branch) => branch.name.toLocaleLowerCase() === branchName.toLocaleLowerCase())) {
      throw new Error(`项目分支“${branchName}”已存在`)
    }

    const selectedPath = snapshotPath(projectRoot, selectedSnapshot.fileName)
    await stat(selectedPath)
    const recovery = await createSnapshotRecord(projectRoot, current, {
      label: '切换前保护快照',
      kind: 'recovery',
    })
    await writeCatalog(projectRoot, recovery.catalog)

    const branchId = randomUUID()
    const nextCatalog = {
      ...recovery.catalog,
      activeBranchId: branchId,
      branches: [...recovery.catalog.branches, {
        id: branchId,
        name: branchName,
        createdAt: isoNow(),
        sourceSnapshotId: selectedSnapshot.id,
        headSnapshotId: selectedSnapshot.id,
      }],
    }

    try {
      await backupDatabase(selectedPath, databasePath(projectRoot))
      await writeCatalog(projectRoot, nextCatalog)
    } catch (error) {
      const recoveryPath = snapshotPath(projectRoot, recovery.record.fileName)
      await backupDatabase(recoveryPath, databasePath(projectRoot))
      throw error
    }
    return publicCatalog(nextCatalog)
  })
}
