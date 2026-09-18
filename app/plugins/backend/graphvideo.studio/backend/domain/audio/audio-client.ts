import type {
  AudioProject,
  VoiceDesignRequest,
  VoiceCloneRequest,
  SpeechSynthesisRequest,
  SfxGenerationRequest,
  AudioGenerationResult,
} from './types';

export interface AudioClientOptions {
  baseUrl?: string;
  projectId?: string;
  timeoutMs?: number;
}

class AudioStudioRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'AudioStudioRequestError';
  }
}

/**
 * 生产级统一音频中台原生客户端 (AudioStudioClient)
 * 对接 Port 5000 API 网关 (Qwen3-TTS / Higgs Audio V3 / Stable Audio 3)
 * 支持 Electron IPC 桥接 (完全绕过 Chromium PNA/CORS 限制) 与直接 fetch 双模驱动
 */
export class AudioStudioClient {
  private baseUrl: string;
  private projectId: string;
  private timeoutMs: number;
  private ensuredProjects = new Set<string>(['default']);

  constructor(options: AudioClientOptions = {}) {
    const globalProcess = (globalThis as any).process;
    const envUrl = globalProcess?.env?.AUDIO_STUDIO_URL || '';
    const storedUrl = (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function')
      ? (localStorage.getItem('gv_audio_studio_url') || '')
      : '';
    this.baseUrl = (options.baseUrl || storedUrl || envUrl || 'http://192.168.10.7:5000/api/v1').replace(/\/+$/, '');
    this.projectId = options.projectId || 'default';
    this.timeoutMs = options.timeoutMs || 60000;
  }

  /**
   * 动态设定局域网中台网关地址 (例如 http://192.168.x.x:5000/api/v1)
   */
  public setServerAddress(lanUrl: string) {
    this.baseUrl = lanUrl.replace(/\/+$/, '');
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem('gv_audio_studio_url', this.baseUrl);
    }
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * 动态绑定当前活动工程 ID (实现多项目声纹与资产物理隔离)
   */
  public setProjectId(projectId: string) {
    if (projectId && projectId.trim()) {
      this.projectId = projectId.trim();
    }
  }

  public getProjectId(): string {
    return this.projectId;
  }

  /**
   * 底层统一 JSON 请求封装 (IPC / Fetch 自动路由)
   */
  private async requestJson(path: string, method: 'GET' | 'POST', body?: any): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    if (typeof window !== 'undefined' && (window as any).graphvideoDesktop?.audioStudio?.dispatch) {
      const res = await (window as any).graphvideoDesktop.audioStudio.dispatch({
        url,
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) {
        throw new AudioStudioRequestError(`[AudioStudio IPC] ${res.error || `HTTP ${res.status}`}`, res.status);
      }
      return res.data;
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new AudioStudioRequestError(`[AudioStudio HTTP] ${res.status}: ${err}`, res.status);
    }
    return await res.json();
  }

  private async postJson(path: string, body?: any): Promise<any> {
    return this.requestJson(path, 'POST', body);
  }

  private async getJson(path: string): Promise<any> {
    return this.requestJson(path, 'GET');
  }

  /**
   * 底层统一音频二进制请求封装 (IPC / Fetch 自动路由)
   */
  private async postAudio(path: string, body: any): Promise<{ audioBlob: Blob; objectUrl: string }> {
    const url = `${this.baseUrl}${path}`;
    if (typeof window !== 'undefined' && (window as any).graphvideoDesktop?.audioStudio?.dispatch) {
      const res = await (window as any).graphvideoDesktop.audioStudio.dispatch({
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) {
        throw new Error(`[AudioStudio IPC] ${res.error || `HTTP ${res.status}`}`);
      }
      const binaryString = atob(res.dataBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBlob = new Blob([bytes], { type: 'audio/wav' });
      const objectUrl = URL.createObjectURL(audioBlob);
      return { audioBlob, objectUrl };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[AudioStudio HTTP] ${res.status}: ${err}`);
    }
    const audioBlob = await res.blob();
    const objectUrl = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(audioBlob) : `audio://${Date.now()}.wav`;
    return { audioBlob, objectUrl };
  }

  /**
   * 自动在远端音频中台确保项目工作区已初始化创建 (Safe ASCII Slug & Auto Provision)
   */
  public async ensureProject(projectId?: string, displayName?: string): Promise<string> {
    const rawId = (projectId || this.projectId || 'default').trim();
    if (rawId === 'default') return 'default';

    // 转换为远端合法的安全 slug（小写字母、数字、下划线）
    let safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    if (!safeId || safeId === '_' || !/[a-zA-Z0-9]/.test(safeId)) {
      safeId = 'debug_project';
    }

    if (this.ensuredProjects.has(safeId)) {
      return safeId;
    }

    try {
      await this.getJson(`/projects/${safeId}`);
      this.ensuredProjects.add(safeId);
      return safeId;
    } catch (error) {
      if (!(error instanceof AudioStudioRequestError) || error.status !== 404) throw error;
    }

    try {
      await this.postJson('/projects', {
        project_id: safeId,
        name: displayName || rawId,
        description: `GraphVideo 工程：${displayName || rawId}`,
      });
    } catch (error) {
      if (!(error instanceof AudioStudioRequestError) || error.status !== 409) throw error;
    }
    this.ensuredProjects.add(safeId);
    return safeId;
  }

  /**
   * 1. 纯文字人设生成角色声纹母带 (Qwen3-TTS Voice Design)
   */
  public async designVoice(req: VoiceDesignRequest): Promise<{ voice_id: string; sample_url: string }> {
    const project = await this.ensureProject();
    return await this.postJson(`/projects/${project}/voice/design`, req);
  }

  /**
   * 2. 上传音频克隆角色 (Higgs Audio Voice Clone)
   */
  public async cloneVoice(req: VoiceCloneRequest): Promise<{ voice_id: string }> {
    const project = await this.ensureProject();
    return await this.postJson(`/projects/${project}/voice/clone`, req);
  }

  /**
   * 3. 戏剧级精细演播语音合成 (Higgs Audio V3 Speech Synthesis with Inline Tags)
   */
  public async synthesizeSpeech(req: SpeechSynthesisRequest): Promise<AudioGenerationResult> {
    const startTime = Date.now();
    const project = await this.ensureProject();
    const payload = {
      voice_id: req.voice_id,
      text: req.text,
      temperature: req.temperature ?? 1.0,
      speed: 1.0, // 强制锁定 1.0 (纯神经标签控速，彻底规避 DSP 变频失真)
      response_format: 'wav',
    };

    const res = await this.postAudio(`/projects/${project}/speech/synthesize`, payload);

    const filename = `speech-${req.voice_id}-${Date.now()}.wav`;
    return {
      kind: 'audio',
      url: res.objectUrl,
      filename,
      audioBlob: res.audioBlob,
      elapsedMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  /**
   * 4. 电影级拟音、音效与背景配乐生成 (Stable Audio 3 SFX & Music)
   */
  public async generateSfx(req: SfxGenerationRequest): Promise<AudioGenerationResult> {
    const startTime = Date.now();
    const project = await this.ensureProject();
    const payload = {
      prompt: req.prompt,
      duration: req.duration ?? 6.0,
      steps: req.steps ?? 8,
      cfg_scale: req.cfg_scale ?? 1.0,
      response_format: 'wav',
    };

    const res = await this.postAudio(`/projects/${project}/audio/generate`, payload);

    const filename = `sfx-${Date.now()}.wav`;
    return {
      kind: 'audio',
      url: res.objectUrl,
      filename,
      audioBlob: res.audioBlob,
      elapsedMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  /**
   * 5. 获取工程内全部声纹与角色列表
   */
  public async listVoices(projectId?: string): Promise<any[]> {
    const targetProject = projectId || this.projectId || 'default';
    const res = await this.getJson(`/projects/${targetProject}/voice/list`);
    return Array.isArray(res) ? res : (res.voices || []);
  }

  /**
   * 6. 获取中台全部项目列表
   */
  public async listProjects(): Promise<AudioProject[]> {
    const res = await this.getJson('/projects');
    return Array.isArray(res) ? res : (res.projects || []);
  }
}

export const defaultAudioStudioClient = new AudioStudioClient();
