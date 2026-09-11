import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { EffectContext } from '@graphvideo/kernel';
import type {
  ArtifactWriteObservation,
  ArtifactWritePort,
  ArtifactWriteRequest,
} from './artifact-file-adapter';

export class NodeFileArtifactWritePort implements ArtifactWritePort {
  readonly id = 'node-fs/artifact-file';

  async write(request: ArtifactWriteRequest, context: EffectContext): Promise<ArtifactWriteObservation> {
    const targetDir = request.exportDirectory;
    const filename = request.artifact.filename;
    const fullPath = join(targetDir, filename);

    await mkdir(dirname(fullPath), { recursive: true });

    let buffer: Buffer;
    if (request.artifact.base64) {
      const b64 = request.artifact.base64.includes(',')
        ? request.artifact.base64.split(',')[1]
        : request.artifact.base64;
      buffer = Buffer.from(b64, 'base64');
    } else if (request.artifact.url?.startsWith('data:')) {
      const b64 = request.artifact.url.split(',')[1];
      buffer = Buffer.from(b64, 'base64');
    } else {
      buffer = Buffer.from('mock artifact content');
    }

    if (context.signal?.aborted) {
      throw context.signal.reason ?? new Error('Artifact 写入已取消');
    }

    await writeFile(fullPath, buffer);

    context.recordRawSummary?.({
      kind: 'node-fs-artifact',
      text: `path=${fullPath};bytes=${buffer.byteLength}`,
      redacted: false,
    });

    return {
      savedPath: fullPath,
      filename,
      mediaType: request.artifact.kind,
      byteLength: buffer.byteLength,
      contentRef: `node-file:${fullPath}:${buffer.byteLength}`,
    };
  }
}
