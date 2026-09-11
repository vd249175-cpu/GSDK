import { beforeAll, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { evaluateGenerationProject, planGenerationBatch } from './generation-batch-planner.mjs'
import { loadGenerationCatalogSnapshot } from '../electron/generation-catalog-snapshot.mjs'

let catalog
beforeAll(async () => {
  catalog = (await loadGenerationCatalogSnapshot(resolve(process.cwd(), 'app/resources/generation-models'))).read()
})

const project = {
  name: 'fixture', path: 'C:/fixture',
  markdown: '<project-structure>\n@参考图\n%视频\n  @参考图\n</project-structure>',
  nodes: [
    { id: 'image-1', type: 'image', title: '参考图', prompt: '---\nmodel: nano-banana-image\n---\nimage', history: [{ id: 'iv1', relativePath: 'nodes/image-1/media/iv1.png', current: true }] },
    { id: 'video-1', type: 'video', title: '视频', prompt: '---\nmodel: seedance-video\n---\nuse [@参考图]', history: [{ id: 'old', relativePath: 'nodes/video-1/media/old.mp4', current: true }] },
  ],
}

describe('generation batch planner', () => {
  it('treats completed media as explicitly regeneratable', () => {
    const item = evaluateGenerationProject(project, catalog).find((entry) => entry.id === 'video-1')
    expect(item.readiness).toMatchObject({ status: 'COMPLETED', missingDependencies: [] })
  })

  it('creates a deterministic complete plan for its Owner Node', () => {
    let sequence = 0
    const plan = planGenerationBatch(project, [{ nodeId: 'video-1' }, { nodeId: 'image-1' }], {
      batchId: 'batch-fixture',
      nextId: () => `fixture-${++sequence}`,
    })
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[0]).toMatchObject({ targetNodeId: 'video-1', mediaType: 'video', versionId: 'v-fixture-1' })
    expect(plan.tasks[0].input.references[0]).toMatchObject({ id: 'image-1', isReady: true })
  })

  it('plans every asset kind in prompt occurrence order even when structure order differs', () => {
    const orderedProject = {
      name: 'ordered', path: 'C:/fixture',
      markdown: '<project-structure>\n%镜头\n  @前景\n  ~环境声\n  @背景\n</project-structure>',
      nodes: [
        { id: 'image-front', type: 'image', title: '前景', prompt: '' },
        { id: 'audio-ambience', type: 'audio', title: '环境声', prompt: '' },
        { id: 'image-back', type: 'image', title: '背景', prompt: '' },
        {
          id: 'shot', type: 'video', title: '镜头',
          prompt: '---\nmodel: seedance-video\n---\n先 [@背景]，再 [~环境声]，最后 [@前景]。',
        },
      ],
    }
    const plan = planGenerationBatch(orderedProject, [{ nodeId: 'shot' }], {
      batchId: 'ordered-batch', nextId: () => 'ordered-1',
    })
    expect(plan.tasks[0].input.references.map((reference) => reference.id)).toEqual([
      'image-back', 'audio-ambience', 'image-front',
    ])
  })
})
