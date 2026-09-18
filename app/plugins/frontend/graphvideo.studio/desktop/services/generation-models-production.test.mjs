import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  listGenerationModels,
  readGenerationModel,
  resolveGenerationPrompt,
  buildGenerationRequest,
  estimateGenerationBudget,
} from './generation-model-store.mjs'

const skillsRoot = fileURLToPath(new URL('../../resources/generation-models', import.meta.url))
const existingMediaFixture = fileURLToPath(import.meta.url)

describe('Production Node-owned Catalog (9 Unified Production Workflows)', () => {
  it('successfully loads all 9 production models with zero errors or issues', async () => {
    const { models, issues } = await listGenerationModels(skillsRoot)
    expect(issues).toEqual([])
    expect(models).toHaveLength(9)

    const ids = models.map((m) => m.id)
    expect(ids).toContain('seedance-video')
    expect(ids).toContain('seedance-flf2v')
    expect(ids).toContain('nano-banana-image')
    expect(ids).toContain('minimax-h3-video')
    expect(ids).toContain('higgs-speech')
    expect(ids).toContain('audio-sfx')
    expect(ids).toContain('qwen-voice-design')
    expect(ids).toContain('chat-image')
    expect(ids).toContain('chat-video')
  })

  it('correctly resolves references, aliases, and defaults for video models', async () => {
    const input = {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-video\nduration: 5\nresolution: "720p"\n---\n\n特写镜头，基于 node_char_hero 与 node_kf_start 运镜推向主体。',
      references: [
        { id: 'node_char_hero', type: 'image', title: '角色立绘', ordinal: 1, filePath: existingMediaFixture, isReady: true },
        { id: 'node_kf_start', type: 'image', title: '首帧', ordinal: 2, filePath: existingMediaFixture, isReady: true },
      ],
    }

    const resolved = await resolveGenerationPrompt(skillsRoot, input)
    expect(resolved.model.id).toBe('seedance-video')
    expect(resolved.prompt).toContain('Image_1')
    expect(resolved.prompt).toContain('Image_2')
    expect(resolved.aliases['node_char_hero']).toBe('Image_1')
    expect(resolved.aliases['node_kf_start']).toBe('Image_2')
    expect(resolved.effectiveConfig.duration).toBe(5)
    expect(resolved.effectiveConfig.resolution).toBe('720p')

    const request = await buildGenerationRequest(skillsRoot, input)
    expect(request.kind).toBe('comfy-workflow')
    expect(request.inputs.duration).toBe(5)
    expect(request.inputs.prompt).toContain('Image_1')
  })

  it('validates cross-asset constraints (e.g. audio duration cannot exceed video duration)', async () => {
    const invalidVideoInput = {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-video\nduration: 4\n---\n镜头画面 node_audio_long',
      references: [
        { id: 'node_audio_long', type: 'audio', title: '超长背景音乐', ordinal: 1, duration: 8.5 },
      ],
    }

    await expect(buildGenerationRequest(skillsRoot, invalidVideoInput)).rejects.toThrow(/超出了目标视频时长/)
  })

  it('rejects referenced media that has no current physical file', async () => {
    await expect(buildGenerationRequest(skillsRoot, {
      nodeType: 'image',
      prompt: '---\nmodel: nano-banana-image\n---\n参考 node_missing',
      references: [
        { id: 'node_missing', type: 'image', title: '缺失参考图', ordinal: 1 },
      ],
    })).rejects.toThrow(/尚未就绪|缺少本地媒体文件/)
  })

  it('rejects empty prompts and invalid parameter values before request assembly', async () => {
    await expect(resolveGenerationPrompt(skillsRoot, {
      nodeType: 'image', prompt: '---\nmodel: nano-banana-image\n---\n', references: [],
    })).rejects.toThrow(/提示词正文不能为空/)

    await expect(buildGenerationRequest(skillsRoot, {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-video\nduration: 999\nresolution: potato\n---\n镜头推进',
      references: [],
    })).rejects.toThrow(/duration.*不能大于|resolution.*允许范围/)
  })

  it('preserves explicit false and zero parameter values', async () => {
    const resolved = await resolveGenerationPrompt(skillsRoot, {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-video\ngenerateAudio: false\nwatermark: false\nseed: 0\n---\n静态镜头',
      references: [],
    })
    expect(resolved.effectiveConfig.generate_audio).toBe(false)
    expect(resolved.effectiveConfig.watermark).toBe(false)
    expect(resolved.effectiveConfig.seed).toBe(0)
  })

  it('correctly estimates credits and budget formulas without Python', async () => {
    const videoEst = await estimateGenerationBudget(skillsRoot, {
      model: 'seedance-video',
      duration: 8,
      resolution: '720p',
    })
    expect(videoEst.estimatedCredits).toBe(415)
    expect(videoEst.mode).toBe('partner_stepped')
    expect(videoEst.formula).toContain('415.0 Credits')

    const customEst = await estimateGenerationBudget(skillsRoot, {
      model: 'minimax-h3-video',
      duration: 10,
      customRate: 3.5,
    })
    expect(customEst.estimatedCredits).toBe(35)
    expect(customEst.mode).toBe('custom_rate')

    const audioEst = await estimateGenerationBudget(skillsRoot, {
      model: 'audio-sfx',
      duration: 15,
    })
    expect(audioEst.estimatedCredits).toBe(0)
    expect(audioEst.currency).toBe('free_lan')
  })

  it('correctly resolves natural tags and style references for seedance-mini-video', async () => {
    const rawPrompt = `---
model: seedance-mini-video
duration: 5
resolution: "480p"
aspectRatio: "16:9"
generateAudio: true
watermark: false
---

The video starts from the exact visual state of [@寝室极速绝杀起幅帧]. Camera executes a dramatic fast Dolly In with a subtle high-impact handheld camera shake as [@主角阿橘] executes rapid, frantic keystrokes on [@发光机械键盘] inside [@大学男生寝室]. [&大学回忆暖金微尘调], fluid high-frame-rate physics.`

    const input = {
      nodeType: 'video',
      prompt: rawPrompt,
      references: [
        { id: 'node_kf_start', type: 'image', title: '寝室极速绝杀起幅帧', ordinal: 1 },
        { id: 'node_char_cat', type: 'image', title: '主角阿橘', ordinal: 2 },
        { id: 'node_keyboard', type: 'image', title: '发光机械键盘', ordinal: 3 },
        { id: 'node_dorm', type: 'image', title: '大学男生寝室', ordinal: 4 },
        { id: 'node_style_warm', type: 'style', title: '大学回忆暖金微尘调', ordinal: 1, content: 'warm golden nostalgia' },
      ],
    }

    const resolved = await resolveGenerationPrompt(skillsRoot, input)
    expect(resolved.prompt).toContain('Image_1')
    expect(resolved.prompt).toContain('Image_2')
    expect(resolved.prompt).toContain('Image_3')
    expect(resolved.prompt).toContain('Image_4')
    expect(resolved.prompt).toContain('Style_1: warm golden nostalgia')
    expect(resolved.prompt).not.toContain('[@大学男生寝室]')
    expect(resolved.prompt).not.toContain('[&大学回忆暖金微尘调]')
  })

  it('supports Seedance workflow model switching and enforces model-specific limits', async () => {
    // Seedance 2.5 allows 20 seconds
    const input25 = {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-video\nseedanceModel: "Seedance 2.5"\nduration: 20\ntaskType: "reference"\n---\n镜头推进 node_hero',
      references: [
        { id: 'node_hero', type: 'image', title: '主角立绘', ordinal: 1, filePath: existingMediaFixture, isReady: true },
      ],
    }
    const req25 = await buildGenerationRequest(skillsRoot, input25)
    expect(req25.inputs.seedance_model).toBe('Seedance 2.5')
    expect(req25.inputs.duration).toBe(20)

    // Seedance 2.0 rejects 20 seconds
    const input20 = {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-video\nseedanceModel: "Seedance 2.0"\nduration: 20\n---\n镜头推进 node_hero',
      references: [
        { id: 'node_hero', type: 'image', title: '主角立绘', ordinal: 1, filePath: existingMediaFixture, isReady: true },
      ],
    }
    await expect(buildGenerationRequest(skillsRoot, input20)).rejects.toThrow(/时长上限为 15 秒/)
  })

  it('supports Seedance FLF2V model selection and validates 2-image requirement', async () => {
    const flf2vInput = {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-flf2v\nseedanceModel: "Seedance 2.5"\nduration: 18\n---\n从 node_f1 过渡到 node_f2',
      references: [
        { id: 'node_f1', type: 'image', title: '首帧', ordinal: 1, filePath: existingMediaFixture, isReady: true },
        { id: 'node_f2', type: 'image', title: '尾帧', ordinal: 2, filePath: existingMediaFixture, isReady: true },
      ],
    }
    const flf2vReq = await buildGenerationRequest(skillsRoot, flf2vInput)
    expect(flf2vReq.inputs.seedance_model).toBe('Seedance 2.5')
    expect(flf2vReq.inputs.duration).toBe(18)

    // Only 1 frame provided -> reject
    const flf2vInvalid = {
      nodeType: 'video',
      prompt: '---\nmodel: seedance-flf2v\n---\n只有一帧 node_f1',
      references: [
        { id: 'node_f1', type: 'image', title: '首帧', ordinal: 1, filePath: existingMediaFixture, isReady: true },
      ],
    }
    await expect(buildGenerationRequest(skillsRoot, flf2vInvalid)).rejects.toThrow(/必须且只能提供首帧与尾帧/)
  })
})
