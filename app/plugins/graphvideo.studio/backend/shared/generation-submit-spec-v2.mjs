import { compileComfyTemplateV2 } from './generation-workflow-package-v2.mjs'

function mediaReferences(request, type) {
  return (request.references ?? []).filter((reference) => reference.type === type && reference.filePath)
}

function audioSpec(request, project) {
  const execution = request.model.execution
  const values = request.inputs
  const base = {
    provider: 'audio',
    projectId: project.id,
    projectName: project.name,
    ...(project.baseUrl ? { baseUrl: project.baseUrl } : {}),
  }
  if (execution.taskType === 'SFX') return { ...base, taskType: 'SFX', payload: values }
  if (execution.taskType === 'SPEECH') {
    const audio = mediaReferences(request, 'audio')[0]
    const voiceReference = values.voice_reference || audio?.metadata?.voice_id || audio?.id
    return {
      ...base,
      taskType: 'SPEECH',
      payload: {
        text: values.prompt,
        voice_id: voiceReference,
        speed: values.speed,
        temperature: values.temperature,
        seed: values.seed ?? 0,
      },
    }
  }
  if (execution.taskType === 'VOICE_DESIGN') {
    const audio = mediaReferences(request, 'audio')[0]
    const voiceId = values.voice_id || values.name || audio?.id || 'custom_voice'
    if (audio) {
      return {
        ...base,
        taskType: 'VOICE_CLONE',
        payload: {
          voice_id: voiceId,
          name: values.name || voiceId,
          description: values.description || '基于录音样本克隆的声纹母带',
          reference_audio_path: audio.filePath,
          reference_text: values.transcript || audio.content || values.prompt,
        },
      }
    }
    return {
      ...base,
      taskType: 'VOICE_DESIGN',
      payload: {
        voice_id: voiceId,
        name: values.name || voiceId,
        description: values.description || values.prompt,
        seed_text: values.prompt || values.seed_text,
        gender: values.gender,
        age: values.age,
        accent: values.accent,
        seed: values.seed,
      },
    }
  }
  throw new Error(`audio-task 不支持 taskType: ${execution.taskType}`)
}

export function compileGenerationSubmitSpecV2(request, project) {
  const execution = request.model?.execution
  if (!execution) throw new Error('v2 生成请求缺少 execution 快照')
  if (execution.kind === 'audio-task') return audioSpec(request, project)
  if (execution.kind === 'mock') return { provider: 'mock', kind: execution.outputKind }
  if (execution.kind === 'comfy-template') return compileComfyTemplateV2(request)
  throw new Error(`v2 执行族尚未实现: ${execution.kind}`)
}
