import type { EffectAdapter, EffectContext } from '@graphvideo/kernel';

export type GenerationProviderId = 'comfy' | 'audio' | 'mock';
export type AudioAdapterTaskType = 'SFX' | 'SPEECH' | 'VOICE_DESIGN' | 'VOICE_CLONE';

export interface ComfyAdapterSubmitSpec {
  readonly provider: 'comfy';
  readonly prompt: Readonly<Record<string, unknown>>;
  readonly expectedOutputKind: 'image' | 'video';
  readonly clientId?: string;
  readonly workflowType?: string;
  readonly uploads?: readonly {
    readonly sourcePath: string;
    readonly nodeId: string;
    readonly inputName: string;
  }[];
}

export interface AudioAdapterSubmitSpec {
  readonly provider: 'audio';
  readonly taskType: AudioAdapterTaskType;
  readonly projectId: string;
  readonly projectName?: string;
  readonly baseUrl?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface MockAdapterSubmitSpec {
  readonly provider: 'mock';
  readonly kind: 'image' | 'video';
}

export type GenerationAdapterSubmitSpec = ComfyAdapterSubmitSpec | AudioAdapterSubmitSpec | MockAdapterSubmitSpec;

export interface GenerationAdapterHandle {
  readonly provider: GenerationProviderId;
  readonly taskId: string;
  readonly apiMode?: 'cloud' | 'local';
  readonly resultKind?: 'remote-url' | 'memory';
}

export interface GenerationAdapterArtifact {
  readonly provider: GenerationProviderId;
  readonly taskId: string;
  readonly kind: 'image' | 'video' | 'audio' | 'unknown';
  readonly filename: string;
  readonly url?: string;
  readonly token?: string;
}

export type GenerationAdapterOperationRequest =
  | {
      readonly operation: 'submit';
      readonly spec: GenerationAdapterSubmitSpec;
    }
  | {
      readonly operation: 'poll';
      readonly handle: GenerationAdapterHandle;
    }
  | {
      readonly operation: 'download';
      readonly artifact: GenerationAdapterArtifact;
      readonly destinationRelativePath: string;
    };

export type GenerationAdapterOperationObservation =
  | {
      readonly operation: 'submit';
      readonly status: 'submitted';
      readonly handle: GenerationAdapterHandle;
    }
  | {
      readonly operation: 'poll';
      readonly status: 'pending';
      readonly progress: number;
      readonly remoteStatus: string;
    }
  | {
      readonly operation: 'poll';
      readonly status: 'ready';
      readonly progress: number;
      readonly artifact: GenerationAdapterArtifact;
    }
  | {
      readonly operation: 'poll';
      readonly status: 'failed';
      readonly progress: 0;
      readonly error: string;
    }
  | {
      readonly operation: 'download';
      readonly status: 'downloaded';
      readonly bytesWritten: number;
      readonly destinationRelativePath: string;
      readonly contentType: string;
    };

export const generationAdapterOperationId = 'graphvideo/generation-adapter-operation-v1';

/** Default composition keeps the graph path dormant until Electron injects the worker adapter. */
export class UnavailableGenerationAdapterOperation implements EffectAdapter<
  GenerationAdapterOperationRequest,
  GenerationAdapterOperationObservation
> {
  readonly id = generationAdapterOperationId;

  async execute(
    request: GenerationAdapterOperationRequest,
    _context: EffectContext,
  ): Promise<GenerationAdapterOperationObservation> {
    throw new Error(`Generation worker adapter is unavailable for ${request.operation}`);
  }
}
