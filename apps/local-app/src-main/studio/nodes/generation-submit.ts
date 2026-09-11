import { WorldNode } from '@graphvideo/kernel';
import type { EffectAdapter, Info, WorldChangeContext } from '@graphvideo/kernel';
import {
  UnavailableGenerationAdapterOperation,
  type GenerationAdapterOperationObservation,
  type GenerationAdapterOperationRequest,
} from '../effects/generation-adapter-operation';
import type {
  GenerationBatchSubmittedObservedInfo,
  GenerationSubmitBatchRequestedInfo,
  GenerationSubmitResult,
} from '../protocol';

export class GenerationSubmitSinkNode extends WorldNode<Record<never, never>> {
  constructor(
    id: string = 'sink-generation-submit',
    name: string = '生成请求提交端',
    private readonly adapter: EffectAdapter<
      GenerationAdapterOperationRequest,
      GenerationAdapterOperationObservation
    > = new UnavailableGenerationAdapterOperation(),
    private readonly taskTargetId: string = 'node-generation-task',
  ) {
    super(id, name, {});
    this.icon = '📤';
    this.description = '并行提交一个准入批次的物理请求；只返回 handle，不轮询或下载';
  }

  protected override async change(
    info: Info,
    ctx: WorldChangeContext<Record<never, never>>,
  ): Promise<void> {
    if (info.type !== 'GenerationSubmitBatchRequestedInfo') return;
    const requested = info as GenerationSubmitBatchRequestedInfo;
    const results = await Promise.all(requested.tasks.map(async (task): Promise<GenerationSubmitResult> => {
      try {
        const observation = await ctx.effectAdapter(this.adapter, {
          operation: 'submit',
          spec: task.submit,
        });
        if (observation.operation !== 'submit' || observation.status !== 'submitted') {
          throw new Error('生成 adapter 提交返回了错误的 Observation');
        }
        return { taskId: task.taskId, ok: true, handle: observation.handle };
      } catch (error) {
        return {
          taskId: task.taskId,
          ok: false,
          provider: task.submit.provider,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    const observedInfo: GenerationBatchSubmittedObservedInfo = {
      type: 'GenerationBatchSubmittedObservedInfo',
      batchId: requested.batchId,
      results,
    };
    ctx.send(observedInfo, this.taskTargetId);
  }
}

