export interface KernelSchedulerSnapshot {
  readonly pendingDeliveries: number;
  readonly activeChanges: number;
  readonly scheduledGraphMicrotasks: number;
  readonly isQuiescent: boolean;
}

export function schedulerCancellationError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error(
    typeof signal.reason === 'string' ? signal.reason : '等待 Kernel 静止已取消',
  );
  error.name = 'AbortError';
  return error;
}

export interface SchedulerKernelContext {
  pendingDeliveryCount: number;
  activeChangeIds: Set<string>;
  scheduledGraphMicrotaskCount: number;
  schedulerListeners: Set<(state: KernelSchedulerSnapshot) => void>;
}

export function computeSchedulerSnapshot(ctx: SchedulerKernelContext): KernelSchedulerSnapshot {
  return {
    pendingDeliveries: ctx.pendingDeliveryCount,
    activeChanges: ctx.activeChangeIds.size,
    scheduledGraphMicrotasks: ctx.scheduledGraphMicrotaskCount,
    isQuiescent:
      ctx.pendingDeliveryCount === 0 &&
      ctx.activeChangeIds.size === 0 &&
      ctx.scheduledGraphMicrotaskCount === 0,
  };
}

export function subscribeSchedulerHelper(
  ctx: SchedulerKernelContext,
  listener: (state: KernelSchedulerSnapshot) => void,
): () => void {
  ctx.schedulerListeners.add(listener);
  return () => {
    ctx.schedulerListeners.delete(listener);
  };
}

export function publishSchedulerStateHelper(ctx: SchedulerKernelContext): void {
  const state = computeSchedulerSnapshot(ctx);
  for (const listener of ctx.schedulerListeners) {
    try {
      listener(state);
    } catch {}
  }
}

export function scheduleGraphMicrotaskHelper<T>(
  ctx: SchedulerKernelContext,
  task: () => T | Promise<T>,
): Promise<T> {
  ctx.scheduledGraphMicrotaskCount += 1;
  publishSchedulerStateHelper(ctx);
  return new Promise<T>((resolve, reject) => {
    queueMicrotask(async () => {
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        ctx.scheduledGraphMicrotaskCount -= 1;
        publishSchedulerStateHelper(ctx);
      }
    });
  });
}

export async function waitForQuiescenceHelper(
  ctx: SchedulerKernelContext,
  options: { signal?: AbortSignal } = {},
): Promise<KernelSchedulerSnapshot> {
  while (true) {
    if (options.signal?.aborted) throw schedulerCancellationError(options.signal);
    const current = computeSchedulerSnapshot(ctx);
    if (current.isQuiescent) return current;
    await new Promise<void>((resolve, reject) => {
      let cleanup = () => undefined;
      const unsubscribe = subscribeSchedulerHelper(ctx, (state) => {
        if (!state.isQuiescent) return;
        cleanup();
        resolve();
      });
      const onAbort = () => {
        cleanup();
        reject(schedulerCancellationError(options.signal!));
      };
      cleanup = () => {
        unsubscribe();
        options.signal?.removeEventListener('abort', onAbort);
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
    });
  }
}
