import type {
  EffectAdapter,
  EffectContext,
} from '@graphvideo/kernel';
import type { GeneratedArtifact } from '../domain/types';

export interface ArtifactWriteRequest {
  readonly taskId?: string;
  readonly targetNodeId: string;
  readonly exportDirectory: string;
  readonly artifact: GeneratedArtifact;
}

export interface ArtifactWriteObservation {
  readonly savedPath: string;
  readonly filename: string;
  readonly mediaType: GeneratedArtifact['kind'];
  readonly byteLength?: number;
  readonly contentRef: string;
  readonly versionId?: string;
}

export interface ArtifactWritePort {
  readonly id: string;
  write(
    request: ArtifactWriteRequest,
    context: EffectContext,
  ): Promise<ArtifactWriteObservation>;
}

export const artifactFileAdapterId = 'graphvideo/artifact-file-v1';

/** Application Adapter: validates GraphVideo artifact semantics, then delegates physical I/O. */
export class ArtifactFileAdapter implements EffectAdapter<
  ArtifactWriteRequest,
  ArtifactWriteObservation
> {
  readonly id = artifactFileAdapterId;

  constructor(private readonly port: ArtifactWritePort) {}

  async execute(request: ArtifactWriteRequest, context: EffectContext) {
    if (!request.targetNodeId.trim()) throw new Error('Artifact 写入缺少 targetNodeId');
    if (!request.exportDirectory.trim()) throw new Error('Artifact 写入缺少 exportDirectory');
    if (!request.artifact.filename?.trim()) throw new Error('Artifact 写入缺少 filename');
    if (!['image', 'video', 'audio'].includes(request.artifact.kind)) {
      throw new Error(`Artifact kind 不支持: ${request.artifact.kind}`);
    }
    if (!request.artifact.base64?.trim() && !request.artifact.url?.trim()) {
      throw new Error('Artifact 写入需要 base64 或 URL 数据源');
    }
    if (context.signal?.aborted) {
      throw context.signal.reason ?? new Error('Artifact 写入已取消');
    }
    context.recordTransport?.({
      portId: this.port.id,
      source: request.artifact.base64 ? 'base64' : 'url',
      mediaType: request.artifact.kind,
    });
    const observation = await this.port.write(request, context);
    if (!observation.savedPath.trim() || !observation.contentRef.trim()) {
      throw new Error('Artifact WritePort 返回的 Observation 不完整');
    }
    return observation;
  }
}
