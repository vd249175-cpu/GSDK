import { WorldNode } from '@graphvideo/kernel';
import type { EffectAdapter, Info, WorldChangeContext } from '@graphvideo/kernel';
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
    this.icon = '⏱️';
    this.description = 'pending 后只等待一个物理间隔并发出新的轮询意图；状态查询仍由独立 poll Node 执行';
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
