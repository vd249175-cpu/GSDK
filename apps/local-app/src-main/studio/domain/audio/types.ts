/**
 * 统一智能音频中台强类型契约 (Unified Audio Domain Types)
 */

export interface AudioProject {
  project_id: string;
  name: string;
  description?: string;
  voice_count?: number;
  production_count?: number;
}

export interface VoiceDesignRequest {
  voice_id: string;
  name: string;
  description: string;
  seed_text?: string;
}

export interface VoiceCloneRequest {
  voice_id: string;
  name: string;
  description?: string;
  reference_audio_base64: string;
  reference_text: string;
}

export interface SpeechSynthesisRequest {
  voice_id: string;
  text: string;
  temperature?: number;
  speed?: number;
  response_format?: 'wav' | 'json';
}

export interface SfxGenerationRequest {
  prompt: string;
  duration?: number;
  steps?: number;
  cfg_scale?: number;
  response_format?: 'wav' | 'json';
}

export type AudioTaskPayload =
  | { type: 'VOICE_DESIGN'; payload: VoiceDesignRequest }
  | { type: 'SPEECH'; payload: SpeechSynthesisRequest }
  | { type: 'SFX'; payload: SfxGenerationRequest }

export interface AudioGenerationResult {
  kind: 'audio';
  url: string;
  filename: string;
  durationSeconds?: number;
  audioBlob?: Blob;
  elapsedMs?: number;
  timestamp: number;
}
