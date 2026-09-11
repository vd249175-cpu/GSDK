import type { GenerationModelInput } from '../../shared/generation-model-input.mjs';
import type {
  GenerationBatchProject,
  GenerationBatchRequestItem,
} from '../../shared/generation-batch-planner.mjs';
import type { Info } from '@graphvideo/kernel';
import type { GenerationModelPackageSnapshot } from '../../shared/generation-model-package.mjs';

export interface GenerationModelResolutionRequestedInfo extends Info {
  readonly type: 'GenerationModelResolutionRequestedInfo';
  readonly requestId: string;
  readonly input: GenerationModelInput;
  readonly catalog: GenerationBatchRequestedInfo['catalog'];
}

export interface GenerationModelResolutionCompletedInfo extends Info {
  readonly type: 'GenerationModelResolutionCompletedInfo';
  readonly requestId: string;
  readonly result: Readonly<Record<string, unknown>>;
}

export interface GenerationModelResolutionFailedInfo extends Info {
  readonly type: 'GenerationModelResolutionFailedInfo';
  readonly requestId: string;
  readonly error: string;
}

export interface GenerationBatchRequestedInfo extends Info {
  readonly type: 'GenerationBatchRequestedInfo';
  readonly batchId: string;
  readonly project: GenerationBatchProject;
  readonly items: readonly GenerationBatchRequestItem[];
  readonly catalog: {
    readonly revision: string;
    readonly models: readonly GenerationModelPackageSnapshot[];
  };
  readonly audioUrl?: string;
  readonly maxGenerationWaitMs?: number;
}
