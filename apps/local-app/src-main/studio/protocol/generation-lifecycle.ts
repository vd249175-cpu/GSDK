import type { Info } from '@graphvideo/kernel';
import type {
  GenerationAdapterArtifact,
  GenerationAdapterHandle,
  GenerationAdapterSubmitSpec,
  GenerationProviderId,
} from '../effects/generation-adapter-operation';

export interface PlannedGenerationTask {
  readonly taskId: string;
  readonly targetNodeId: string;
  readonly destinationRelativePath: string;
  readonly versionId: string;
  readonly mediaType: 'image' | 'video' | 'audio';
  readonly estimatedCredits: number;
  readonly submit: GenerationAdapterSubmitSpec;
  readonly autoPoll?: boolean;
  readonly maxGenerationWaitMs?: number;
}

export interface GenerationBatchPlannedInfo extends Info {
  readonly type: 'GenerationBatchPlannedInfo';
  readonly batchId: string;
  readonly tasks: readonly PlannedGenerationTask[];
}

export interface GenerationBatchCancelRequestedInfo extends Info {
  readonly type: 'GenerationBatchCancelRequestedInfo';
  readonly batchId: string;
  readonly reason?: string;
}

export interface GenerationTasksPollRequestedInfo extends Info {
  readonly type: 'GenerationTasksPollRequestedInfo';
  readonly taskIds: readonly string[];
}

export interface GenerationSubmitBatchRequestedInfo extends Info {
  readonly type: 'GenerationSubmitBatchRequestedInfo';
  readonly batchId: string;
  readonly tasks: readonly PlannedGenerationTask[];
}

export type GenerationSubmitResult =
  | {
      readonly taskId: string;
      readonly ok: true;
      readonly handle: GenerationAdapterHandle;
    }
  | {
      readonly taskId: string;
      readonly ok: false;
      readonly provider: GenerationProviderId;
      readonly error: string;
    };

export interface GenerationBatchSubmittedObservedInfo extends Info {
  readonly type: 'GenerationBatchSubmittedObservedInfo';
  readonly batchId: string;
  readonly results: readonly GenerationSubmitResult[];
}

export interface GenerationPollBatchItem {
  readonly taskId: string;
  readonly handle: GenerationAdapterHandle;
}

export interface GenerationPollBatchRequestedInfo extends Info {
  readonly type: 'GenerationPollBatchRequestedInfo';
  readonly batchId: string;
  readonly tasks: readonly GenerationPollBatchItem[];
}

export type GenerationPollResult =
  | {
      readonly taskId: string;
      readonly ok: true;
      readonly status: 'pending';
      readonly progress: number;
      readonly remoteStatus: string;
    }
  | {
      readonly taskId: string;
      readonly ok: true;
      readonly status: 'ready';
      readonly progress: number;
      readonly artifact: GenerationAdapterArtifact;
    }
  | {
      readonly taskId: string;
      readonly ok: false;
      readonly error: string;
    };

export interface GenerationBatchPolledObservedInfo extends Info {
  readonly type: 'GenerationBatchPolledObservedInfo';
  readonly batchId: string;
  readonly results: readonly GenerationPollResult[];
}

export interface GenerationDownloadBatchItem {
  readonly taskId: string;
  readonly artifact: GenerationAdapterArtifact;
  readonly destinationRelativePath: string;
}

export interface GenerationDownloadBatchRequestedInfo extends Info {
  readonly type: 'GenerationDownloadBatchRequestedInfo';
  readonly batchId: string;
  readonly tasks: readonly GenerationDownloadBatchItem[];
}

export type GenerationDownloadResult =
  | {
      readonly taskId: string;
      readonly ok: true;
      readonly bytesWritten: number;
      readonly destinationRelativePath: string;
      readonly contentType: string;
      readonly filename: string;
    }
  | {
      readonly taskId: string;
      readonly ok: false;
      readonly error: string;
    };

export interface GenerationBatchDownloadedObservedInfo extends Info {
  readonly type: 'GenerationBatchDownloadedObservedInfo';
  readonly batchId: string;
  readonly results: readonly GenerationDownloadResult[];
}
