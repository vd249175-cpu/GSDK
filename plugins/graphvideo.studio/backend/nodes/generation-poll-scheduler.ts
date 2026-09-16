import { WorldNode } from '@graphvideo/sdk/node';
import type { EffectAdapter } from '@graphvideo/sdk/node';
import type { Info, WorldChangeContext } from '@graphvideo/sdk/protocol';
import {
  GenerationPollDelayAdapter,
  type GenerationPollDelayObservation,
  type GenerationPollDelayRequest,
} from '../effects/generation-poll-delay';
import type { GenerationPollScheduleRequestedInfo, GenerationTasksPollRequestedInfo } from '../protocol';

export class GenerationPollSchedulerNode extends WorldNode<Record<never, never>> {
  constructor(
    id: string = 'src-generation-poll-scheduler',
    name: string = '生成轮询调度源',
    private readonly delayAdapter: EffectAdapter<GenerationPollDelayRequest, GenerationPollDelayObservation> = new GenerationPollDelayAdapter(),
    private readonly taskTargetId: string = 'node-generation-task',
  ) {
    super(id, name, {});
  }

  protected override async change(info: Info, ctx: WorldChangeContext<Record<never, never>>) {
    if (info.type !== 'GenerationPollScheduleRequestedInfo') return;
    const requested = info as GenerationPollScheduleRequestedInfo;
    const observation = await ctx.effectAdapter(this.delayAdapter, {
      delayMs: requested.delayMs ?? 1_000,
      taskIds: requested.taskIds,
    });
    const pollInfo: GenerationTasksPollRequestedInfo = {
      type: 'GenerationTasksPollRequestedInfo',
      taskIds: observation.taskIds,
    };
    ctx.send(pollInfo, this.taskTargetId);
  }
}
