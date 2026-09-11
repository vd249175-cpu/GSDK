import { describe, expect, it } from 'vitest'
import {
  applyComfyUiBindings,
  buildComfyUiPrompt,
  comfyUiViewUrl,
  runComfyUiWorkflow,
  validateComfyUiWorkflow,
} from './workflow.mjs'

function workflow(overrides = {}) {
  return validateComfyUiWorkflow({
    schemaVersion: 1,
    id: 'test-image',
    name: '测试工作流',
    description: '测试用工作流。',
    mediaType: 'image',
    provider: 'comfyui',
    graph: {
      '1': {
        class_type: 'KSampler',
        inputs: { seed: 1, steps: 20, cfg: 8, model: ['2', 0] },
        _meta: { title: '多余字段' },
      },
      '2': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'a.safetensors' },
      },
    },
    bindings: {
      seed: { node: '1', input: 'seed' },
      steps: { node: '1', input: 'steps' },
      checkpoint: { node: '2', input: 'ckpt_name' },
    },
    defaults: { steps: 28 },
    ...overrides,
  })
}

describe('validateComfyUiWorkflow', () => {
  it('归一化配置并丢弃节点上的 _meta', () => {
    const config = workflow()
    expect(config.graph['1']).toEqual({ class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 8, model: ['2', 0] } })
    expect(config.provider).toBe('comfyui')
    expect(config.defaults).toEqual({ steps: 28 })
  })

  it('拒绝错误 schemaVersion、mediaType 与 id', () => {
    expect(() => workflow({ schemaVersion: 2 })).toThrow(/schemaVersion/)
    expect(() => workflow({ mediaType: 'text' })).toThrow(/mediaType/)
    expect(() => workflow({ id: 'BAD_ID' })).toThrow(/^id 只能使用/)
  })

  it('拒绝指向不存在节点或输入的绑定', () => {
    expect(() => workflow({ bindings: { seed: { node: '9', input: 'seed' } } })).toThrow(/不存在的节点：9/)
    expect(() => workflow({ bindings: { seed: { node: '1', input: 'cfg2' } } })).toThrow(/不存在的输入：1\.cfg2/)
  })

  it('拒绝未声明绑定或非标量的默认值', () => {
    expect(() => workflow({ defaults: { unknown: 1 } })).toThrow(/未声明绑定的默认值：unknown/)
    expect(() => workflow({ defaults: { steps: [1, 2] } })).toThrow(/必须是字符串、数字或布尔值/)
  })

  it('拒绝非法 baseUrl', () => {
    expect(() => workflow({ baseUrl: '127.0.0.1:8000' })).toThrow(/http\(s\)/)
  })
})

describe('applyComfyUiBindings', () => {
  it('把 defaults 与覆盖值写入 graph 副本，不修改原配置', () => {
    const config = workflow()
    const graph = applyComfyUiBindings(config, { seed: 42 })
    expect(graph['1'].inputs.seed).toBe(42)
    expect(graph['1'].inputs.steps).toBe(28)
    expect(graph['2'].inputs.ckpt_name).toBe('a.safetensors')
    expect(config.graph['1'].inputs.seed).toBe(1)
  })

  it('拒绝未声明参数与非标量值', () => {
    const config = workflow()
    expect(() => applyComfyUiBindings(config, { unknown: 1 })).toThrow(/工作流不支持参数：unknown/)
    expect(() => applyComfyUiBindings(config, { seed: {} })).toThrow(/必须是字符串、数字或布尔值/)
  })
})

describe('buildComfyUiPrompt', () => {
  it('构建 /prompt 请求体，client_id 可选', () => {
    const config = workflow()
    expect(buildComfyUiPrompt(config)).toEqual({
      prompt: { '1': { class_type: 'KSampler', inputs: { seed: 1, steps: 28, cfg: 8, model: ['2', 0] } }, '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a.safetensors' } } },
    })
    expect(buildComfyUiPrompt(config, {}, 'client-1').client_id).toBe('client-1')
  })
})

function mediaWorkflow(overrides = {}) {
  return validateComfyUiWorkflow({
    schemaVersion: 1,
    id: 'media-test',
    name: '媒体测试',
    description: '测试媒体列表绑定。',
    mediaType: 'video',
    provider: 'comfyui',
    graph: {
      '1': {
        class_type: 'GeminiNanoBanana2',
        inputs: { prompt: 'p', images: [['2', 0]] },
      },
      '2': { class_type: 'LoadImage', inputs: { image: 'old.png' } },
      '3': {
        class_type: 'ByteDance2ReferenceNode',
        inputs: { model: 'Seedance 2.0', seed: 0, 'model.reference_images.image_1': ['2', 0] },
      },
    },
    bindings: {
      images: { node: '1', input: 'images', kind: 'media-list', media: 'image', shape: 'list', maxCount: 14 },
      referenceImages: { node: '3', input: 'model.reference_images.', kind: 'media-list', media: 'image', shape: 'slots', slotPrefix: 'image', maxCount: 9 },
    },
    defaults: {},
    ...overrides,
  })
}

describe('media-list 绑定校验', () => {
  it('归一化 kind/media/shape/slotPrefix/maxCount', () => {
    const config = mediaWorkflow()
    expect(config.bindings.images).toEqual({ node: '1', input: 'images', kind: 'media-list', media: 'image', shape: 'list', maxCount: 14 })
    expect(config.bindings.referenceImages.slotPrefix).toBe('image')
  })

  it('拒绝非法 kind、media、shape', () => {
    expect(() => mediaWorkflow({ bindings: { images: { node: '1', input: 'images', kind: 'list' } } })).toThrow(/kind 只能是/)
    expect(() => mediaWorkflow({ bindings: { images: { node: '1', input: 'images', kind: 'media-list', media: 'text', shape: 'list' } } })).toThrow(/media 只能是/)
    expect(() => mediaWorkflow({ bindings: { images: { node: '1', input: 'images', kind: 'media-list', media: 'image', shape: 'map' } } })).toThrow(/shape 只能是/)
  })

  it('拒绝 slots 形状缺少点号前缀、slotPrefix 或非法 slotPrefix', () => {
    expect(() => mediaWorkflow({ bindings: { referenceImages: { node: '3', input: 'model.reference_images', kind: 'media-list', media: 'image', shape: 'slots', slotPrefix: 'image' } } })).toThrow(/点号结尾/)
    expect(() => mediaWorkflow({ bindings: { referenceImages: { node: '3', input: 'model.reference_images.', kind: 'media-list', media: 'image', shape: 'slots' } } })).toThrow(/slotPrefix不能为空/)
    expect(() => mediaWorkflow({ bindings: { referenceImages: { node: '3', input: 'model.reference_images.', kind: 'media-list', media: 'image', shape: 'slots', slotPrefix: '9bad' } } })).toThrow(/slotPrefix 只能/)
  })

  it('拒绝非法 maxCount 与超限/非数组默认值', () => {
    expect(() => mediaWorkflow({ bindings: { images: { node: '1', input: 'images', kind: 'media-list', media: 'image', shape: 'list', maxCount: 0 } } })).toThrow(/maxCount/)
    expect(() => mediaWorkflow({ defaults: { images: ['a.png', 'b.png'] }, bindings: { images: { node: '1', input: 'images', kind: 'media-list', media: 'image', shape: 'list', maxCount: 1 } } })).toThrow(/超过最大数量/)
    expect(() => mediaWorkflow({ defaults: { images: 'a.png' } })).toThrow(/必须是文件名数组/)
  })
})

describe('applyComfyUiBindings media-list', () => {
  it('list 形状：多文件创建加载器并写入链接列表', () => {
    const graph = applyComfyUiBindings(mediaWorkflow(), { images: ['a.png', 'b.png'] })
    expect(graph['1'].inputs.images).toEqual([['graphvideo-load-image-1', 0], ['graphvideo-load-image-2', 0]])
    expect(graph['graphvideo-load-image-1']).toEqual({ class_type: 'LoadImage', inputs: { image: 'a.png' } })
    expect(graph['graphvideo-load-image-2']).toEqual({ class_type: 'LoadImage', inputs: { image: 'b.png' } })
  })

  it('list 形状：空数组删除输入键', () => {
    const graph = applyComfyUiBindings(mediaWorkflow(), { images: [] })
    expect(Object.hasOwn(graph['1'].inputs, 'images')).toBe(false)
  })

  it('slots 形状：清空前缀键后写入编号槽位', () => {
    const graph = applyComfyUiBindings(mediaWorkflow(), { referenceImages: ['x.png', 'y.png'] })
    const keys = Object.keys(graph['3'].inputs).filter((key) => key.startsWith('model.reference_images.'))
    expect(keys).toEqual(['model.reference_images.image_1', 'model.reference_images.image_2'])
    expect(graph['3'].inputs['model.reference_images.image_1']).toEqual(['graphvideo-load-image-1', 0])
  })

  it('slots 形状：空数组移除全部前缀键', () => {
    const graph = applyComfyUiBindings(mediaWorkflow(), { referenceImages: [] })
    expect(Object.keys(graph['3'].inputs).some((key) => key.startsWith('model.reference_images.'))).toBe(false)
  })

  it('生成节点 ID 避开图中已有 ID', () => {
    const config = validateComfyUiWorkflow({
      ...mediaWorkflow(),
      graph: { ...mediaWorkflow().graph, 'graphvideo-load-image-1': { class_type: 'LoadImage', inputs: { image: 'clash.png' } } },
    })
    const graph = applyComfyUiBindings(config, { images: ['a.png'] })
    expect(graph['1'].inputs.images).toEqual([['graphvideo-load-image-2', 0]])
  })

  it('拒绝非数组值与超限数量', () => {
    expect(() => applyComfyUiBindings(mediaWorkflow(), { images: 'a.png' })).toThrow(/必须是文件名数组/)
    expect(() => applyComfyUiBindings(mediaWorkflow(), { referenceImages: ['1.png', '2.png', '3.png', '4.png', '5.png', '6.png', '7.png', '8.png', '9.png', '10.png'] })).toThrow(/最多 9 个文件/)
  })
})

describe('comfyUiViewUrl', () => {
  it('编码文件名、子目录与类型', () => {
    const url = comfyUiViewUrl('http://127.0.0.1:8000/', { filename: 'a b.png', subfolder: 'video/x', type: 'temp' })
    expect(url).toBe('http://127.0.0.1:8000/view?filename=a+b.png&subfolder=video%2Fx&type=temp')
  })
})

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload }
}

describe('runComfyUiWorkflow', () => {
  it('提交后轮询 history，完成后收集全部输出与 /view 地址', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/prompt')) return jsonResponse({ prompt_id: 'p-1' })
      if (url.includes('/history/p-1')) {
        if (calls.length <= 2) return jsonResponse({})
        return jsonResponse({
          'p-1': {
            status: { status_str: 'success', completed: true },
            outputs: {
              '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }, { filename: 'b.png', subfolder: 'x', type: 'temp' }] },
              '10': { videos: [{ filename: 'v.mp4', subfolder: 'video', type: 'output' }] },
            },
          },
        })
      }
      throw new Error(`unexpected url ${url}`)
    }
    const result = await runComfyUiWorkflow(workflow(), { fetch: fetchImpl, baseUrl: 'http://127.0.0.1:8000/', clientId: 'client-1', pollIntervalMs: 5 })
    expect(result.promptId).toBe('p-1')
    expect(result.outputs).toEqual([
      { kind: 'image', filename: 'a.png', subfolder: '', type: 'output', url: 'http://127.0.0.1:8000/view?filename=a.png&type=output' },
      { kind: 'image', filename: 'b.png', subfolder: 'x', type: 'temp', url: 'http://127.0.0.1:8000/view?filename=b.png&subfolder=x&type=temp' },
      { kind: 'video', filename: 'v.mp4', subfolder: 'video', type: 'output', url: 'http://127.0.0.1:8000/view?filename=v.mp4&subfolder=video&type=output' },
    ])
    const promptCall = calls[0]
    expect(promptCall.init.body).toBe(JSON.stringify({
      prompt: { '1': { class_type: 'KSampler', inputs: { seed: 1, steps: 28, cfg: 8, model: ['2', 0] } }, '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a.safetensors' } } },
      client_id: 'client-1',
    }))
  })

  it('归一化 /prompt 的错误响应', async () => {
    const fetchImpl = async () => jsonResponse({ error: { message: 'checkpoint 不存在' } }, 400)
    await expect(runComfyUiWorkflow(workflow(), { fetch: fetchImpl })).rejects.toThrow(/返回 400：checkpoint 不存在/)
  })

  it('拒绝缺少 prompt_id 的响应', async () => {
    const fetchImpl = async () => jsonResponse({})
    await expect(runComfyUiWorkflow(workflow(), { fetch: fetchImpl })).rejects.toThrow(/缺少 prompt_id/)
  })

  it('history 状态为 error 时抛错', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/prompt')) return jsonResponse({ prompt_id: 'p-1' })
      return jsonResponse({ 'p-1': { status: { status_str: 'error', messages: [['执行失败', 'OOM']] } } })
    }
    await expect(runComfyUiWorkflow(workflow(), { fetch: fetchImpl, pollIntervalMs: 5 })).rejects.toThrow(/执行失败: OOM/)
  })

  it('轮询超过 timeoutMs 抛超时', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/prompt')) return jsonResponse({ prompt_id: 'p-1' })
      return jsonResponse({})
    }
    await expect(runComfyUiWorkflow(workflow(), { fetch: fetchImpl, timeoutMs: 40, pollIntervalMs: 10 })).rejects.toThrow(/执行超时/)
  })
})
