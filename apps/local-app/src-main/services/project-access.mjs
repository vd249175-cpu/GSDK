export function isProjectGraphBusy(runtime) {
  if (!runtime) return false
  const scheduler = runtime.projection.read().scheduler
  if (scheduler.activeChanges || scheduler.pendingDeliveries || scheduler.scheduledGraphMicrotasks) return true
  const tasks = runtime.projection.readNodeState('node-generation-task')?.tasks
  return tasks instanceof Map && [...tasks.values()].some((task) =>
    ['submitting', 'polling', 'waiting', 'downloading', 'persisting'].includes(task.phase))
}

/** Main-process physical project lifetime, not graph business state.
 * Refuse switches while old operations are in flight rather than rebinding
 * their adapters to another project's files. Never wait holding this gate.
 */
export class ProjectAccess {
  constructor(isGraphBusy = () => false) {
    this.isGraphBusy = isGraphBusy
    this.active = 0
    this.switching = false
    this.epoch = 0
    this.preparedBatches = new Map()
  }

  async run(operation) {
    if (this.switching) throw new Error('项目正在切换，请稍后重试')
    this.active += 1
    try { return await operation() } finally { this.active -= 1 }
  }

  async switchProject(operation) {
    if (this.switching || this.active || this.isGraphBusy()) {
      throw new Error('项目仍有生成或持久化任务，请等待完成或取消后再切换')
    }
    this.switching = true
    this.epoch += 1
    this.preparedBatches.clear()
    try { return await operation() } finally { this.switching = false }
  }

  prepareBatch(info) {
    const now = Date.now()
    for (const [id, entry] of this.preparedBatches) {
      if (entry.expiresAt <= now) this.preparedBatches.delete(id)
    }
    if (this.preparedBatches.size >= 128) throw new Error('待提交生成批次过多')
    this.preparedBatches.set(info.batchId, {
      info: structuredClone(info), epoch: this.epoch, expiresAt: now + 600_000,
    })
    // Project data, model pricing and physical paths never round-trip through
    // renderer-controlled payloads. The main process consumes this once.
    return { batchId: info.batchId, info: { type: info.type, batchId: info.batchId } }
  }

  consumeBatch(batchId) {
    const entry = this.preparedBatches.get(batchId)
    this.preparedBatches.delete(batchId)
    if (!entry || entry.epoch !== this.epoch || entry.expiresAt <= Date.now()) {
      throw new Error('生成批次已失效，请在当前项目重新提交')
    }
    return entry.info
  }
}
