import type { EffectAdapter, EffectContext } from '@graphvideo/kernel';
import type {
  AudioGenerationResult,
  AudioTaskPayload,
  SfxGenerationRequest,
  SpeechSynthesisRequest,
  VoiceDesignRequest,
} from '../domain/audio/types';

export interface AudioGatewayClient {
  setServerAddress(address: string): void;
  getBaseUrl(): string;
  setProjectId(projectId: string): void;
  getProjectId(): string;
  designVoice(request: VoiceDesignRequest): Promise<{
    voice_id: string;
    sample_url: string;
    elapsed_seconds?: number;
  }>;
  synthesizeSpeech(request: SpeechSynthesisRequest): Promise<AudioGenerationResult>;
  generateSfx(request: SfxGenerationRequest): Promise<AudioGenerationResult>;
}

export interface AudioGatewayRequest {
  readonly task: AudioTaskPayload;
  readonly projectId?: string;
}

export class AudioGatewayAdapter implements EffectAdapter<
  AudioGatewayRequest,
  AudioGenerationResult
> {
  readonly id = 'graphvideo/audio-gateway-v1';

  constructor(private readonly client: AudioGatewayClient) {}

  setServerAddress(address: string) {
    this.client.setServerAddress(address);
  }

  getBaseUrl() {
    return this.client.getBaseUrl();
  }

  setProjectId(projectId: string) {
    this.client.setProjectId(projectId);
  }

  async execute(request: AudioGatewayRequest, context: EffectContext) {
    if (request.projectId?.trim()) this.client.setProjectId(request.projectId);
    if (context.signal?.aborted) {
      throw context.signal.reason ?? new Error('Audio Gateway 请求已取消');
    }
    const task = request.task;
    context.recordTransport?.({
      gateway: 'audio-studio',
      operation: task.type,
      projectId: request.projectId || this.client.getProjectId(),
    });
    let result: AudioGenerationResult;
    if (task.type === 'VOICE_DESIGN') {
      const design = await this.client.designVoice(task.payload);
      result = {
        kind: 'audio',
        url: design.sample_url,
        filename: `voice-${task.payload.voice_id}.wav`,
        elapsedMs: design.elapsed_seconds
          ? Math.round(design.elapsed_seconds * 1000)
          : 0,
        timestamp: context.clock.now(),
      };
    } else if (task.type === 'SPEECH') {
      result = await this.client.synthesizeSpeech(task.payload);
    } else if (task.type === 'SFX') {
      result = await this.client.generateSfx(task.payload);
    } else {
      const exhaustive: never = task;
      throw new Error(`Audio task 不支持: ${String(exhaustive)}`);
    }
    context.recordRawSummary?.({
      kind: 'audio-gateway-response',
      text: `kind=${result.kind};filename=${result.filename};bytes=${result.audioBlob?.size ?? 0}`,
      redacted: false,
    });
    return result;
  }
}
