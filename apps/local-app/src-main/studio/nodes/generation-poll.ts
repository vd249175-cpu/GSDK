import { WorldNode } from '@graphvideo/kernel';
import type { EffectAdapter, Info, WorldChangeContext } from '@graphvideo/kernel';
import {
  UnavailableGenerationAdapterOperation,
  type GenerationAdapterOperationObservation,
  type GenerationAdapterOperationRequest,
} from '../effects/generation-adapter-operation';
import type {
  GenerationBatchPolledObservedInfo,
  GenerationPollBatchRequestedInfo,
  GenerationPollResult,
} from '../protocol';

export class GenerationPollSourceNode extends WorldNode<Record<never, never>> {
  constructor(
    id: string = 'src-generation-poll',
    name: string = '生成状态单次观测端',
    private readonly adapter: EffectAdapter<
      GenerationAdapterOperationRequest,
      GenerationAdapterOperationObservation
    > = new UnavailableGenerationAdapterOperation(),
    private readonly taskTargetId: string = 'node-generation-task',
  ) {
    super(id, name, {});
    this.icon = '🔎';
    this.description = '对批次内每个 handle 并行查询一次状态；pending 不会自动再次轮询';
  }

  protected override async change(
    info: Info,
    ctx: WorldChangeContext<Record<never, never>>,
  ): Promise<void> {
    if (info.type !== 'GenerationPollBatchRequestedInfo') return;
    const requested = info as GenerationPollBatchRequestedInfo;
    const results = await Promise.all(requested.tasks.map(async (task): Promise<GenerationPollResult> => {
      try {
        const observation = await ctx.effectAdapter(this.adapter, {
          operation: 'poll',
          handle: task.handle,
        });
        if (observation.operation !== 'poll') {
          throw new Error('生成 adapter 轮询返回了错误的 Observation');
        }
        if (observation.status === 'failed') {
          return { taskId: task.taskId, ok: false, error: observation.error };
        }
        return observation.status === 'ready'
          ? {
              taskId: task.taskId,
              ok: true,
              status: 'ready',
              progress: observation.progress,
              artifact: observation.artifact,
            }
          : {
              taskId: task.taskId,
              ok: true,
              status: 'pending',
              progress: observation.progress,
              remoteStatus: observation.remoteStatus,
            };
      } catch (error) {
        return {
          taskId: task.taskId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    const observedInfo: GenerationBatchPolledObservedInfo = {
      type: 'GenerationBatchPolledObservedInfo',
      batchId: requested.batchId,
      results,
    };
    ctx.send(observedInfo, this.taskTargetId);
  }
}

