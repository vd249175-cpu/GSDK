import type { Info } from '@graphvideo/kernel';
import type { ComfyUiWorkflowConfig, GeneratedArtifact } from '../domain/types';
import type { ArtifactWriteObservation } from '../effects/artifact-file-adapter';

export interface GenerationRequestPayload {
  readonly targetNodeId?: string;
  readonly prompt: string;
  readonly workflowId?: string;
  readonly estimatedCredits?: number;
  readonly overrideValues?: Record<string, unknown>;
  readonly workflow?: ComfyUiWorkflowConfig;
}

export interface UserGenerationRequestedInfo extends Info {
  readonly type: 'UserGenerationRequestedInfo';
  readonly request: GenerationRequestPayload;
}

export interface GenerateAssetTaskInfo extends Info {
  readonly type: 'GenerateAssetTaskInfo';
  readonly taskId: string;
  readonly targetNodeId?: string;
  readonly request: GenerationRequestPayload;
}

export interface GenerationCompletedInfo extends Info {
  readonly type: 'GenerationCompletedInfo';
  readonly taskId?: string;
  readonly targetNodeId: string;
  readonly artifact: GeneratedArtifact;
}

export interface ArtifactSavedObservedInfo extends Info {
  readonly type: 'ArtifactSavedObservedInfo';
  readonly taskId?: string;
  readonly targetNodeId: string;
  readonly versionId?: string;
  readonly relativePath: string;
  readonly filename: string;
  readonly mediaType: 'image' | 'video' | 'audio';
}

export interface PhysicalFileWrittenInfo extends Info {
  readonly type: 'PhysicalFileWrittenInfo';
  readonly taskId?: string;
  readonly targetNodeId: string;
  readonly observation: ArtifactWriteObservation;
}

export interface GenerationBudgetConfiguredInfo extends Info {
  readonly type: 'GenerationBudgetConfiguredInfo';
  readonly maxBudget: number;
}

export interface GenerationCreditsResetInfo extends Info {
  readonly type: 'GenerationCreditsResetInfo';
}
