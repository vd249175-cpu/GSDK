import { WorldNode } from '@graphvideo/kernel';
import type { EffectAdapter, Info, WorldChangeContext } from '@graphvideo/kernel';
import {
  UnavailableGenerationAdapterOperation,
  type GenerationAdapterOperationObservation,
  type GenerationAdapterOperationRequest,
} from '../effects/generation-adapter-operation';
import type {
  GenerationBatchDownloadedObservedInfo,
  GenerationDownloadBatchRequestedInfo,
  GenerationDownloadResult,
} from '../protocol';

export class GenerationDownloadSinkNode extends WorldNode<Record<never, never>> {
  constructor(
    id: string = 'sink-generation-download',
    name: string = '生成产物下载端',
    private readonly adapter: EffectAdapter<
      GenerationAdapterOperationRequest,
      GenerationAdapterOperationObservation
    > = new UnavailableGenerationAdapterOperation(),
    private readonly taskTargetId: string = 'node-generation-task',
  ) {
    super(id, name, {});
    this.icon = '📥';
    this.description = '只下载已经由轮询确认 ready 的产物，并返回物理写入 Observation';
  }

  protected override async change(
    info: Info,
    ctx: WorldChangeContext<Record<never, never>>,
  ): Promise<void> {
    if (info.type !== 'GenerationDownloadBatchRequestedInfo') return;
    const requested = info as GenerationDownloadBatchRequestedInfo;
    await Promise.all(requested.tasks.map(async (task) => {
      let result: GenerationDownloadResult;
      try {
        const observation = await ctx.effectAdapter(this.adapter, {
          operation: 'download',
          artifact: task.artifact,
          destinationRelativePath: task.destinationRelativePath,
        });
        if (observation.operation !== 'download' || observation.status !== 'downloaded') {
          throw new Error('生成 adapter 下载返回了错误的 Observation');
        }
        result = {
          taskId: task.taskId,
          ok: true,
          bytesWritten: observation.bytesWritten,
          destinationRelativePath: observation.destinationRelativePath,
          contentType: observation.contentType,
          filename: task.artifact.filename,
        };
      } catch (error) {
        result = {
          taskId: task.taskId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      // A completed artifact must reach its State owners even if a sibling transfer is slow.
      const observedInfo: GenerationBatchDownloadedObservedInfo = {
        type: 'GenerationBatchDownloadedObservedInfo',
        batchId: requested.batchId,
        results: [result],
      };
      ctx.send(observedInfo, this.taskTargetId);
    }));
  }
}
