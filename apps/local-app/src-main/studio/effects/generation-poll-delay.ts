import type { EffectAdapter, EffectContext } from '@graphvideo/kernel';

export interface GenerationPollDelayRequest {
  readonly delayMs: number;
  readonly taskIds: readonly string[];
}

export interface GenerationPollDelayObservation {
  readonly elapsed: true;
  readonly taskIds: readonly string[];
}

export class GenerationPollDelayAdapter implements EffectAdapter<
  GenerationPollDelayRequest,
  GenerationPollDelayObservation
> {
  readonly id = 'graphvideo/generation-poll-delay-v1';

  async execute(request: GenerationPollDelayRequest, context: EffectContext) {
    if (!Number.isFinite(request.delayMs) || request.delayMs < 0) throw new Error('轮询延迟必须是非负数');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, request.delayMs);
      const abort = () => {
        clearTimeout(timer);
        reject(context.signal?.reason ?? new Error('生成轮询调度已取消'));
      };
      if (context.signal?.aborted) abort();
      else context.signal?.addEventListener('abort', abort, { once: true });
    });
    return { elapsed: true as const, taskIds: request.taskIds };
  }
}
