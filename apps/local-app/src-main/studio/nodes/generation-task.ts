import { Node } from '@graphvideo/kernel';
import type { ChangeContext, Info } from '@graphvideo/kernel';
import type {
  GenerationAdapterHandle,
  GenerationProviderId,
} from '../effects/generation-adapter-operation';
import type {
  GenerationBatchDownloadedObservedInfo,
  GenerationBatchCancelRequestedInfo,
  GenerationBatchPlannedInfo,
  GenerationBatchPolledObservedInfo,
  GenerationBatchSubmittedObservedInfo,
  GenerationDownloadBatchItem,
  GenerationDownloadBatchRequestedInfo,
  GenerationPollBatchItem,
  GenerationPollBatchRequestedInfo,
  GenerationSubmitBatchRequestedInfo,
  GenerationTasksPollRequestedInfo,
  GenerationPollScheduleRequestedInfo,
  PlannedGenerationTask,
  GenerationModelResolutionCompletedInfo,
  GenerationModelResolutionFailedInfo,
  ArtifactSavedObservedInfo,
} from '../protocol';

export type GenerationTaskPhase =
  | 'submitting'
  | 'polling'
  | 'waiting'
  | 'downloading'
  | 'persisting'
  | 'downloaded'
  | 'failed'
  | 'canceled';

export interface GenerationTaskRecord {
  readonly taskId: string;
  readonly batchId: string;
  readonly targetNodeId: string;
  readonly provider: GenerationProviderId;
  readonly destinationRelativePath: string;
  readonly versionId: string;
  readonly mediaType: 'image' | 'video' | 'audio';
  readonly phase: GenerationTaskPhase;
  readonly progress: number;
  readonly handle: GenerationAdapterHandle | null;
  readonly error: string;
  readonly autoPoll: boolean;
  readonly startedAt: number;
  readonly maxGenerationWaitMs: number;
}

export interface GenerationTaskState {
  readonly tasks: Map<string, GenerationTaskRecord>;
}

function checkedDestination(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('生成下载目标必须是项目内相对路径');
  }
  if (segments.some((segment) => segment === '..')) {
    throw new Error('生成下载目标不得越出项目目录');
  }
  return normalized;
}

function checkedPlannedTasks(tasks: readonly PlannedGenerationTask[]) {
  if (tasks.length === 0) throw new Error('生成批次不能为空');
  const ids = new Set<string>();
  const targets = new Set<string>();
  return tasks.map((task) => {
    if (!task.taskId || !task.targetNodeId) throw new Error('生成任务缺少稳定标识');
    if (ids.has(task.taskId)) throw new Error(`生成批次包含重复任务: ${task.taskId}`);
    if (targets.has(task.targetNodeId)) throw new Error(`生成批次包含重复目标: ${task.targetNodeId}`);
    if (!Number.isFinite(task.estimatedCredits) || task.estimatedCredits < 0) {
      throw new Error(`生成任务积分无效: ${task.taskId}`);
    }
    if (
      task.maxGenerationWaitMs !== undefined
      && (!Number.isFinite(task.maxGenerationWaitMs) || task.maxGenerationWaitMs < 0)
    ) {
      throw new Error(`生成任务等待时间无效: ${task.taskId}`);
    }
    ids.add(task.taskId);
    targets.add(task.targetNodeId);
    return {
      ...task,
      destinationRelativePath: checkedDestination(task.destinationRelativePath),
    };
  });
}

export class GenerationTaskNode extends Node<GenerationTaskState> {
  constructor(
    id: string = 'node-generation-task',
    name: string = '生成任务状态控制器',
    private readonly submitTargetId: string = 'node-sec-gate',
    private readonly pollTargetId: string = 'src-generation-poll',
    private readonly downloadTargetId: string = 'sink-generation-download',
    private readonly pollSchedulerTargetId: string = 'src-generation-poll-scheduler',
    private readonly artifactObservedTargetId: string = 'node-sec-gate',
  ) {
    super(id, name, { tasks: new Map() });
    this.icon = '🧭';
    this.description = '生成任务阶段唯一 Owner；按 Info 推进提交、单次轮询与下载，不执行物理 I/O';
  }

  protected override async change(
    info: Info,
    ctx: ChangeContext<GenerationTaskState>,
  ): Promise<void> {
    if (info.type === 'GenerationModelResolutionCompletedInfo') {
      void (info as GenerationModelResolutionCompletedInfo);
      return;
    }
    if (info.type === 'GenerationModelResolutionFailedInfo') {
      void (info as GenerationModelResolutionFailedInfo);
      return;
    }
    if (info.type === 'GenerationBatchPlannedInfo') {
      const planned = info as GenerationBatchPlannedInfo;
      const tasks = checkedPlannedTasks(planned.tasks);
      const next = new Map(ctx.read('tasks'));
      const startedAt = this.runtimeNow();
      const activeTargets = new Set([...next.values()]
        .filter((task) => !['downloaded', 'failed', 'canceled'].includes(task.phase))
        .map((task) => task.targetNodeId));
      for (const task of tasks) {
        if (activeTargets.has(task.targetNodeId)) {
          throw new Error(`生成目标仍在执行: ${task.targetNodeId}`);
        }
        const existing = next.get(task.taskId);
        if (existing) {
          throw new Error(`生成任务标识已使用: ${task.taskId}`);
        }
        next.set(task.taskId, {
          taskId: task.taskId,
          batchId: planned.batchId,
          targetNodeId: task.targetNodeId,
          provider: task.submit.provider,
          destinationRelativePath: task.destinationRelativePath,
          versionId: task.versionId,
          mediaType: task.mediaType,
          phase: 'submitting',
          progress: 0,
          handle: null,
          error: '',
          autoPoll: task.autoPoll === true,
          startedAt,
          maxGenerationWaitMs: Math.round(task.maxGenerationWaitMs ?? 0),
        });
      }
      ctx.write('tasks', next);
      const submitInfo: GenerationSubmitBatchRequestedInfo = {
        type: 'GenerationSubmitBatchRequestedInfo',
        batchId: planned.batchId,
        tasks,
      };
      ctx.send(submitInfo, this.submitTargetId);
      return;
    }

    if (info.type === 'GenerationBatchCancelRequestedInfo') {
      const requested = info as GenerationBatchCancelRequestedInfo;
      const next = new Map(ctx.read('tasks'));
      let changed = false;
      for (const [taskId, current] of next) {
        if (
          current.batchId !== requested.batchId
          || ['downloaded', 'failed', 'canceled'].includes(current.phase)
        ) continue;
        next.set(taskId, {
          ...current,
          phase: 'canceled',
          error: requested.reason?.trim() || '用户已取消生成',
        });
        changed = true;
      }
      if (changed) ctx.write('tasks', next);
      return;
    }

    if (info.type === 'GenerationBatchSubmittedObservedInfo') {
      const observed = info as GenerationBatchSubmittedObservedInfo;
      const next = new Map(ctx.read('tasks'));
      const pollTasks: GenerationPollBatchItem[] = [];
      for (const result of observed.results) {
        const current = next.get(result.taskId);
        if (!current || current.phase !== 'submitting') continue;
        if (!result.ok) {
          next.set(result.taskId, { ...current, phase: 'failed', error: result.error });
          continue;
        }
        next.set(result.taskId, {
          ...current,
          phase: 'polling',
          progress: 10,
          handle: result.handle,
          error: '',
        });
        pollTasks.push({ taskId: result.taskId, handle: result.handle });
      }
      ctx.write('tasks', next);
      if (pollTasks.length > 0) {
        const pollInfo: GenerationPollBatchRequestedInfo = {
          type: 'GenerationPollBatchRequestedInfo',
          batchId: observed.batchId,
          tasks: pollTasks,
        };
        ctx.send(pollInfo, this.pollTargetId);
      }
      return;
    }

    if (info.type === 'GenerationBatchPolledObservedInfo') {
      const observed = info as GenerationBatchPolledObservedInfo;
      const next = new Map(ctx.read('tasks'));
      const downloads: GenerationDownloadBatchItem[] = [];
      const scheduledPollTaskIds: string[] = [];
      for (const result of observed.results) {
        const current = next.get(result.taskId);
        if (!current || current.phase !== 'polling') continue;
        if (!result.ok) {
          next.set(result.taskId, { ...current, phase: 'failed', progress: 0, error: result.error });
        } else if (result.status === 'pending') {
          if (
            current.maxGenerationWaitMs > 0
            && this.runtimeNow() - current.startedAt >= current.maxGenerationWaitMs
          ) {
            next.set(result.taskId, {
              ...current,
              phase: 'failed',
              progress: 0,
              error: `生成等待超过 ${Math.round(current.maxGenerationWaitMs / 60_000)} 分钟`,
            });
            continue;
          }
          next.set(result.taskId, {
            ...current,
            phase: 'waiting',
            progress: result.progress,
            error: '',
          });
          if (current.autoPoll) scheduledPollTaskIds.push(result.taskId);
        } else {
          next.set(result.taskId, {
            ...current,
            phase: 'downloading',
            progress: result.progress,
            error: '',
          });
          downloads.push({
            taskId: result.taskId,
            artifact: result.artifact,
            destinationRelativePath: current.destinationRelativePath,
          });
        }
      }
      ctx.write('tasks', next);
      if (downloads.length > 0) {
        const downloadInfo: GenerationDownloadBatchRequestedInfo = {
          type: 'GenerationDownloadBatchRequestedInfo',
          batchId: observed.batchId,
          tasks: downloads,
        };
        ctx.send(downloadInfo, this.downloadTargetId);
      }
      if (scheduledPollTaskIds.length > 0) {
        const scheduleInfo: GenerationPollScheduleRequestedInfo = {
          type: 'GenerationPollScheduleRequestedInfo',
          taskIds: scheduledPollTaskIds,
        };
        ctx.send(scheduleInfo, this.pollSchedulerTargetId);
      }
      return;
    }

    if (info.type === 'GenerationBatchDownloadedObservedInfo') {
      const observed = info as GenerationBatchDownloadedObservedInfo;
      const next = new Map(ctx.read('tasks'));
      for (const result of observed.results) {
        const current = next.get(result.taskId);
        if (!current || current.phase !== 'downloading') continue;
        next.set(result.taskId, result.ok
          ? { ...current, phase: 'persisting', progress: 100, error: '' }
          : { ...current, phase: 'failed', progress: 0, error: result.error });
        if (result.ok) {
          const savedInfo: ArtifactSavedObservedInfo = {
            type: 'ArtifactSavedObservedInfo',
            taskId: result.taskId,
            targetNodeId: current.targetNodeId,
            versionId: current.versionId,
            relativePath: result.destinationRelativePath,
            filename: result.filename,
            mediaType: current.mediaType,
          };
          ctx.send(savedInfo, this.artifactObservedTargetId);
        }
      }
      ctx.write('tasks', next);
      return;
    }

    if (info.type === 'DatabaseSavedObservedInfo' || info.type === 'DatabaseWriteFailedObservedInfo') {
      const taskId = String(info.taskId ?? '');
      const next = new Map(ctx.read('tasks'));
      const current = next.get(taskId);
      if (!current || current.phase !== 'persisting') return;
      next.set(taskId, info.type === 'DatabaseSavedObservedInfo'
        ? { ...current, phase: 'downloaded', error: '' }
        : { ...current, phase: 'failed', error: String(info.error ?? '生成产物元数据写入失败') });
      ctx.write('tasks', next);
      return;
    }

    if (info.type === 'GenerationTasksPollRequestedInfo') {
      const requested = info as GenerationTasksPollRequestedInfo;
      const next = new Map(ctx.read('tasks'));
      const pollTasks: GenerationPollBatchItem[] = [];
      let changed = false;
      for (const taskId of requested.taskIds) {
        const current = next.get(taskId);
        if (!current || current.phase !== 'waiting' || !current.handle) continue;
        if (
          current.maxGenerationWaitMs > 0
          && this.runtimeNow() - current.startedAt >= current.maxGenerationWaitMs
        ) {
          next.set(taskId, {
            ...current,
            phase: 'failed',
            progress: 0,
            error: `生成等待超过 ${Math.round(current.maxGenerationWaitMs / 60_000)} 分钟`,
          });
          changed = true;
          continue;
        }
        next.set(taskId, { ...current, phase: 'polling', error: '' });
        changed = true;
        pollTasks.push({ taskId, handle: current.handle });
      }
      if (changed) ctx.write('tasks', next);
      if (pollTasks.length > 0) {
        const pollInfo: GenerationPollBatchRequestedInfo = {
          type: 'GenerationPollBatchRequestedInfo',
          batchId: `poll:${pollTasks.map((task) => task.taskId).join(',')}`,
          tasks: pollTasks,
        };
        ctx.send(pollInfo, this.pollTargetId);
      }
    }
  }
}
