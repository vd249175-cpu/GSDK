import type { Info } from '@graphvideo/kernel';

export interface GenerationPollScheduleRequestedInfo extends Info {
  readonly type: 'GenerationPollScheduleRequestedInfo';
  readonly taskIds: readonly string[];
  readonly delayMs?: number;
}
