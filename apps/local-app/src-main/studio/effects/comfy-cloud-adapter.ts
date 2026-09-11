import type { EffectAdapter, EffectContext } from '@graphvideo/kernel';
import type { ComfyUiWorkflowConfig, GeneratedArtifact } from '../domain/types';
import { defaultComfyCloudClient } from '../domain/generation/comfy-cloud-client';

export const comfyCloudAdapterId = 'graphvideo/comfy-cloud-v1';

export interface ComfyCloudRequest {
  readonly workflow: ComfyUiWorkflowConfig;
  readonly values: Record<string, unknown>;
}

export interface ComfyCloudGateway {
  executeWorkflow(
    workflow: ComfyUiWorkflowConfig,
    values: Record<string, unknown>,
    options: { signal?: AbortSignal },
  ): Promise<GeneratedArtifact>;
}

export class ComfyCloudAdapter implements EffectAdapter<ComfyCloudRequest, GeneratedArtifact> {
  readonly id = comfyCloudAdapterId;

  constructor(private readonly client: ComfyCloudGateway = defaultComfyCloudClient) {}

  async execute(request: ComfyCloudRequest, context: EffectContext) {
    context.recordTransport?.({
      provider: 'comfy-cloud',
      workflowId: request.workflow.id,
      mediaType: request.workflow.mediaType,
    });
    const artifact = await this.client.executeWorkflow(
      request.workflow,
      request.values,
      { signal: context.signal },
    );
    context.recordRawSummary?.({
      kind: 'comfy-cloud-artifact',
      text: `kind=${artifact.kind};filename=${artifact.filename}`,
      redacted: false,
    });
    return artifact;
  }
}
