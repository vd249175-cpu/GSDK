import type {
  GenerationBatchExecutionResult,
  GenerationBatchItemInput,
} from '../contract/domain'
import type { ApplicationState } from '../../core/state/types'

function countBy(values: readonly string[]) {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

export function completedGenerationBatchFromState(input: {
  batchId: string
  requests: readonly GenerationBatchItemInput[]
  state: ApplicationState
}): GenerationBatchExecutionResult {
  const graph = input.state.runtime.taskGraphs[input.batchId]
  const records = graph ? Object.values(graph.tasks) : []
  if (records.length !== input.requests.length) {
    throw new Error(`生成批次任务不完整：请求 ${input.requests.length} 项，实际创建 ${records.length} 项`)
  }
  const expectedTargets = countBy(input.requests.map((request) => request.nodeId))
  const actualTargets = countBy(records.map((record) => record.targetNodeId))
  for (const [nodeId, count] of expectedTargets) {
    if (actualTargets.get(nodeId) !== count) throw new Error(`生成批次缺少目标任务：${nodeId}`)
  }
  const failed = records.filter((record) => record.status === 'failed')
  if (failed.length) {
    throw new Error(failed.map((record) => (
      `${record.targetNodeId}: ${record.error || '生成失败'}`
    )).join('；'))
  }
  const canceled = records.filter((record) => record.status === 'canceled')
  if (canceled.length) {
    throw new Error(canceled.map((record) => (
      `${record.targetNodeId}: ${record.error || '生成已取消'}`
    )).join('；'))
  }
  const unfinished = records.filter((record) => record.phase !== 'downloaded')
  if (unfinished.length) {
    throw new Error(`生成批次尚未完成物理下载：${unfinished.map((record) => record.targetNodeId).join('、')}`)
  }
  const missingVersions = records.filter((record) => {
    const node = input.state.project.nodes[record.targetNodeId]
    const currentVersions = (node?.history ?? []).filter((version) => version.current === true)
    return currentVersions.length !== 1
      || currentVersions[0].id !== record.versionId
      || currentVersions[0].relativePath !== record.destinationRelativePath
  })
  if (missingVersions.length) {
    throw new Error(`生成产物未进入项目历史或不是唯一当前版本：${missingVersions.map((record) => record.targetNodeId).join('、')}`)
  }
  return {
    status: 'completed',
    batchId: input.batchId,
    items: records.map((record) => ({
      nodeId: record.targetNodeId,
      taskId: record.id,
      versionId: record.versionId,
      status: 'downloaded',
    })),
  }
}
