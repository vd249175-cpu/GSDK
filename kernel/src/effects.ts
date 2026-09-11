import type { Clock } from './observation';

/** Optional diagnostics are supplied only by an explicit test harness. */
export interface EffectContext {
  readonly clock: Clock;
  readonly signal?: AbortSignal;
  recordTransport?(metadata: unknown): void;
  recordRawSummary?(summary: {
    readonly kind: string;
    readonly text: string;
    readonly redacted?: boolean;
  }): void;
}

export interface EffectAdapter<Request = unknown, Observation = unknown> {
  readonly id: string;
  execute(request: Request, context: EffectContext): Promise<Observation>;
}
