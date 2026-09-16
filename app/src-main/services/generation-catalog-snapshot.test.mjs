import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GenerationCatalogSnapshotStore } from './generation-catalog-snapshot.mjs'

let testRoot = ''

async function writePackage(directory, id, marker = 'one') {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'model.json'), JSON.stringify({
    schemaVersion: 2, id, name: id, description: marker, mediaType: 'image', provider: 'mock',
    parameters: {}, defaults: {}, budget: { kind: 'free' }, capabilities: { allowDelete: true, allowReplace: true },
  }))
  await writeFile(join(directory, 'execution.json'), JSON.stringify({
    schemaVersion: 2, kind: 'mock', outputKind: 'image',
  }))
}

afterEach(async () => {
  const resolved = resolve(testRoot || '.')
  const safeParent = resolve(process.cwd(), '.test-temp')
  if (resolved.startsWith(safeParent) && basename(resolved).startsWith('catalog-snapshot-')) {
    await rm(resolved, { recursive: true, force: true })
  }
  testRoot = ''
})

describe('immutable generation catalog snapshots', () => {
  it('loads once, serves stable cloned snapshots and changes revision on reload', async () => {
    await mkdir(resolve(process.cwd(), '.test-temp'), { recursive: true })
    testRoot = await mkdtemp(join(resolve(process.cwd(), '.test-temp'), 'catalog-snapshot-'))
    await writePackage(join(testRoot, 'models', 'model-a'), 'model-a')
    const store = new GenerationCatalogSnapshotStore(testRoot)
    const first = await store.load()
    expect(store.select(['model-a']).models[0].model.id).toBe('model-a')
    const cloned = store.read()
    cloned.models[0].model.name = 'mutated'
    expect(store.read().models[0].model.name).toBe('model-a')
    await writePackage(join(testRoot, 'models', 'model-a'), 'model-a', 'two')
    const second = await store.load()
    expect(second.revision).not.toBe(first.revision)
  })

  it('imports and deletes packages atomically', async () => {
    await mkdir(resolve(process.cwd(), '.test-temp'), { recursive: true })
    testRoot = await mkdtemp(join(resolve(process.cwd(), '.test-temp'), 'catalog-snapshot-'))
    const source = join(testRoot, 'source', 'model-b')
    await writePackage(source, 'model-b')
    const store = new GenerationCatalogSnapshotStore(join(testRoot, 'catalog'))
    await store.load()
    await store.importPackage(source)
    expect(store.select(['model-b']).models).toHaveLength(1)
    await store.deletePackage('model-b')
    expect(() => store.select(['model-b'])).toThrow(/未找到/)
  })

  it('retains the previous snapshot when reload encounters an unsafe package', async () => {
    await mkdir(resolve(process.cwd(), '.test-temp'), { recursive: true })
    testRoot = await mkdtemp(join(resolve(process.cwd(), '.test-temp'), 'catalog-snapshot-'))
    await writePackage(join(testRoot, 'models', 'model-a'), 'model-a')
    const store = new GenerationCatalogSnapshotStore(testRoot)
    const previous = await store.load()
    const unsafe = join(testRoot, 'models', 'unsafe')
    await writePackage(unsafe, 'unsafe')
    await writeFile(join(unsafe, 'model.py'), 'raise RuntimeError("unsafe")')
    await expect(store.load()).rejects.toThrow(/不允许的文件/)
    expect(store.read()).toEqual(previous)
  })
})
