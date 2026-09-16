import {
  parseGenerationPrompt, type GenerationModelManifest, type NodeType,
} from '@graphvideo/client-sdk'

export type GenerationModelStatusKind = 'ready' | 'pending' | 'warning'

export interface GenerationModelStatus {
  kind: GenerationModelStatusKind
  label: string
  title: string
}

export function resolveGenerationModelStatus(
  nodeType: NodeType,
  prompt: string,
  models: GenerationModelManifest[],
  serviceAvailable: boolean,
  catalogReady: boolean,
): GenerationModelStatus | null {
  if (nodeType === 'text' || nodeType === 'style') return null
  if (!serviceAvailable) {
    return { kind: 'warning', label: '模型能力不可用', title: '桌面生成模型能力当前不可用' }
  }
  let modelId: string | null
  try {
    modelId = parseGenerationPrompt(prompt).modelId
  } catch (error) {
    return {
      kind: 'warning',
      label: '模型配置无效',
      title: error instanceof Error ? error.message : '生成提示词 YAML 无法解析',
    }
  }
  if (!modelId) {
    return { kind: 'warning', label: '尚未选择模型', title: '生成提示词 YAML 头部未声明 model' }
  }
  if (!catalogReady) {
    return { kind: 'pending', label: modelId, title: '正在读取生成模型目录' }
  }
  const model = models.find((candidate) => candidate.id === modelId)
  if (!model) {
    return { kind: 'warning', label: `${modelId} 未安装`, title: '模型目录中不存在该模型' }
  }
  if (model.mediaType !== nodeType) {
    return {
      kind: 'warning',
      label: `${model.name} 类型不匹配`,
      title: `该模型用于 ${model.mediaType}，当前节点类型为 ${nodeType}`,
    }
  }
  return { kind: 'ready', label: model.name, title: model.description }
}
