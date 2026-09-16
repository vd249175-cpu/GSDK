import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildGenerationRequest, deleteGenerationModel, importGenerationModel,
  listGenerationModels, observeGenerationProjectMedia, resolveGenerationPrompt,
} from './generation-model-store.mjs'

let testRoot = ''

async function createModel(directory, id = 'custom-video') {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'model.json'), JSON.stringify({
    schemaVersion: 2,
    id,
    name: 'Custom Video',
    description: 'Test model.',
    mediaType: 'video',
    provider: 'comfy',
    capabilities: { allowDelete: true, allowReplace: true },
    parameters: { durationSeconds: { type: 'integer' } },
    defaults: { durationSeconds: 5 },
    budget: { kind: 'free' },
  }))
  await writeFile(join(directory, 'execution.json'), JSON.stringify({
    schemaVersion: 2, kind: 'comfy-template', workflow: 'workflow.json', outputKind: 'video',
  }))
  await writeFile(join(directory, 'workflow.json'), JSON.stringify({
    1: { class_type: 'SaveVideo', inputs: {} },
  }))
}

afterEach(async () => {
  const resolved = resolve(testRoot || '.')
  const safeParent = resolve(process.cwd(), '.test-temp')
  if (resolved.startsWith(safeParent)
    && basename(resolved).startsWith('graphvideo-generation-models-')) {
    await rm(resolved, { recursive: true, force: true })
  }
  testRoot = ''
})

describe('data-only generation model store', () => {
  it('imports, resolves, builds requests and deletes declarative model definitions', async () => {
    const temporaryRoot = resolve(process.cwd(), '.test-temp')
    await mkdir(temporaryRoot, { recursive: true })
    testRoot = await mkdtemp(join(temporaryRoot, 'graphvideo-generation-models-'))
    const catalogRoot = join(testRoot, 'catalog')
    const source = join(testRoot, 'source', 'custom-video')
    await createModel(source)
    await importGenerationModel(catalogRoot, source)
    expect((await listGenerationModels(catalogRoot)).models.map((item) => item.id)).toContain('custom-video')
    const input = {
      nodeType: 'video',
      prompt: '---\nmodel: custom-video\ndurationSeconds: 8\n---\n\n参考 node_image。',
      references: [{
        id: 'node_image', type: 'image', title: '参考图', ordinal: 1,
        filePath: join(source, 'model.json'), isReady: true,
      }],
    }
    expect((await resolveGenerationPrompt(catalogRoot, input)).prompt).toContain('Image_1')
    const request = await buildGenerationRequest(catalogRoot, input)
    expect(request.inputs.durationSeconds).toBe(8)
    expect(request.inputs.prompt).toContain('Image_1')
    await deleteGenerationModel(catalogRoot, 'custom-video')
    expect((await listGenerationModels(catalogRoot)).models.map((item) => item.id)).not.toContain('custom-video')
  })

  it('rejects media type mismatches and undeclared YAML parameters', async () => {
    const temporaryRoot = resolve(process.cwd(), '.test-temp')
    await mkdir(temporaryRoot, { recursive: true })
    testRoot = await mkdtemp(join(temporaryRoot, 'graphvideo-generation-models-'))
    const catalogRoot = join(testRoot, 'catalog')
    const source = join(testRoot, 'source', 'custom-video')
    await createModel(source)
    await importGenerationModel(catalogRoot, source)
    await expect(resolveGenerationPrompt(catalogRoot, {
      nodeType: 'image', prompt: '---\nmodel: custom-video\n---\nbody', references: [],
    })).rejects.toThrow(/只能用于 video/)
    await expect(resolveGenerationPrompt(catalogRoot, {
      nodeType: 'video', prompt: '---\nmodel: custom-video\nseed: 1\n---\nbody', references: [],
    })).rejects.toThrow(/不支持参数/)
  })

  it('does not accept executable model.py imports', async () => {
    const temporaryRoot = resolve(process.cwd(), '.test-temp')
    await mkdir(temporaryRoot, { recursive: true })
    testRoot = await mkdtemp(join(temporaryRoot, 'graphvideo-generation-models-'))
    const source = join(testRoot, 'source', 'unsafe-model')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'model.py'), 'raise RuntimeError("must not execute")')
    await expect(importGenerationModel(join(testRoot, 'catalog'), source)).rejects.toThrow()
  })

  it('returns a stable explicit error for schema v1 packages', async () => {
    const temporaryRoot = resolve(process.cwd(), '.test-temp')
    await mkdir(temporaryRoot, { recursive: true })
    testRoot = await mkdtemp(join(temporaryRoot, 'graphvideo-generation-models-'))
    const source = join(testRoot, 'source', 'legacy-model')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'model.json'), JSON.stringify({ schemaVersion: 1, id: 'legacy-model' }))
    await writeFile(join(source, 'execution.json'), '{}')
    await expect(importGenerationModel(join(testRoot, 'catalog'), source)).rejects.toThrow(/schemaVersion 必须是 2/)
  })

  it('removes stale history versions from generation readiness observations', async () => {
    const temporaryRoot = resolve(process.cwd(), '.test-temp')
    await mkdir(temporaryRoot, { recursive: true })
    testRoot = await mkdtemp(join(temporaryRoot, 'graphvideo-generation-models-'))
    const existingPath = 'nodes/image-1/media/existing.png'
    await mkdir(join(testRoot, 'nodes', 'image-1', 'media'), { recursive: true })
    await writeFile(join(testRoot, existingPath), 'fixture')

    const observed = await observeGenerationProjectMedia({
      path: testRoot,
      nodes: [{
        id: 'image-1',
        history: [
          { id: 'existing', relativePath: existingPath, current: true },
          { id: 'missing', relativePath: 'nodes/image-1/media/missing.png', current: false },
        ],
      }],
    })

    expect(observed.nodes[0].history.map((version) => version.id)).toEqual(['existing'])
  })
})
