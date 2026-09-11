import type { ComfyUiWorkflowConfig, GeneratedArtifact } from '../types';
import { ComfyUiWorkflowEngine } from './comfyui-workflow';

export interface ComfyCloudExecutionOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  onProgress?: (percent: number, statusText: string) => void;
  signal?: AbortSignal;
}

/**
 * 生产级 ComfyUI Cloud 原生执行客户端 (ComfyCloudClient)
 * 职责：
 * 1. 负责向 Comfy Cloud API 发起真实的异步工作流提交 (/api/prompt)
 * 2. 自动注入 Partner 节点的 `extra_data.api_key_comfy_org` 认证通道
 * 3. 轮询作业状态 (/api/jobs/{promptId}) 与进度推送
 * 4. 自动解析产物并返回媒体直链
 */
export class ComfyCloudClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string = '', baseUrl: string = 'https://cloud.comfy.org') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private getEffectiveApiKey(explicitKey?: string): string {
    if (explicitKey && explicitKey.trim() && explicitKey !== 'COMFY_CLOUD_API_KEY_REDACTED') {
      return explicitKey.trim();
    }
    if (this.apiKey && this.apiKey.trim() && this.apiKey !== 'COMFY_CLOUD_API_KEY_REDACTED') {
      return this.apiKey.trim();
    }
    const globalProcess = (globalThis as any).process;
    const envKey = globalProcess?.env?.COMFY_API_KEY || globalProcess?.env?.COMFY_CLOUD_API_KEY;
    if (envKey && envKey.trim() && envKey !== 'COMFY_CLOUD_API_KEY_REDACTED') {
      return envKey.trim();
    }
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('gv_comfy_api_key') || localStorage.getItem('COMFY_API_KEY') || localStorage.getItem('COMFY_CLOUD_API_KEY');
      if (stored && stored.trim()) return stored.trim();
    }
    return '';
  }

  /**
   * 提交并等待工作流生成完成
   */
  public async executeWorkflow(
    config: ComfyUiWorkflowConfig,
    values: Record<string, any>,
    options: ComfyCloudExecutionOptions = {}
  ): Promise<GeneratedArtifact> {
    const { onProgress, signal, timeoutMs = 180000 } = options;
    const apiKey = this.getEffectiveApiKey(options.apiKey);

    onProgress?.(5, '正在编译与校验工作流图...');

    // 1. 构建标准 ComfyUI Prompt Payload
    const promptGraph = ComfyUiWorkflowEngine.applyBindings(config, values);
    const payload = {
      client_id: `gv-client-${Date.now()}`,
      prompt: promptGraph,
      extra_data: {
        api_key_comfy_org: apiKey,
      },
    };

    onProgress?.(15, '正在向 Comfy Cloud 提交作业...');

    // 2. 发起云端请求 (在 Electron 中自动走 IPC 规避浏览器 CORS 拦截)
    let promptId: string;
    try {
      const postRes = await this.dispatchHttp({
        url: `${this.baseUrl}/api/prompt`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey, 'Authorization': `Bearer ${apiKey}` } : {}),
        },
        body: payload,
        signal,
      });

      if (!postRes.ok) {
        throw new Error(postRes.error || `Comfy Cloud 提交失败 [${postRes.status}]`);
      }

      const resJson = postRes.data;
      if (!resJson?.prompt_id) {
        throw new Error(`Comfy Cloud 未返回有效 prompt_id: ${JSON.stringify(resJson)}`);
      }
      promptId = resJson.prompt_id;
    } catch (err: any) {
      if (err.name === 'AbortError' || signal?.aborted) {
        throw new Error('生成作业已被用户取消');
      }
      throw err;
    }

    onProgress?.(25, `作业已排队: ${promptId}，正在调度 GPU 计算...`);

    // 3. 轮询作业执行状态 (/api/jobs/{prompt_id})
    const startTime = Date.now();
    let currentPercent = 25;

    while (Date.now() - startTime < timeoutMs) {
      if (signal?.aborted) {
        throw new Error('生成作业已被用户取消');
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        // 1. 优先查询官方轻量 /api/job/{promptId}/status 端点
        const statusRes = await this.dispatchHttp({
          url: `${this.baseUrl}/api/job/${promptId}/status`,
          method: 'GET',
          headers: apiKey ? { 'X-API-Key': apiKey, 'Authorization': `Bearer ${apiKey}` } : {},
          signal,
        });

        const statusData = (statusRes.ok && statusRes.data) ? statusRes.data : null;
        const currentStatus = statusData?.status;

        // 遇到官方终态错误直接抛出异常
        if (currentStatus && ['error', 'non_retryable_error', 'lost', 'cancelled', 'failed'].includes(currentStatus)) {
          const errMsg = statusData?.error || statusData?.message || `Comfy Cloud 执行失败 (${currentStatus})`;
          throw new Error(errMsg);
        }

        // 2. 查询完整作业输出 (/api/jobs/{promptId})
        const jobRes = await this.dispatchHttp({
          url: `${this.baseUrl}/api/jobs/${promptId}`,
          method: 'GET',
          headers: apiKey ? { 'X-API-Key': apiKey, 'Authorization': `Bearer ${apiKey}` } : {},
          signal,
        });

        const job = (jobRes.ok && jobRes.data) ? jobRes.data : null;
        
        if (job) {
          if (['error', 'non_retryable_error', 'lost', 'cancelled', 'failed'].includes(job.status)) {
            const errMsg = job.execution_error?.exception_message || job.error || 'Comfy Cloud 执行异常';
            throw new Error(errMsg);
          }

          const outputs = job.outputs || job.output || {};
          const hasOutputs = outputs && Object.keys(outputs).length > 0;

          if (job.status === 'completed' || job.status === 'success' || currentStatus === 'success' || (job.outputs_count > 0) || hasOutputs) {
            onProgress?.(92, '计算完成，正在下载产物数据...');
            return await this.extractArtifactFromJob(config, job, promptId, apiKey);
          }
        }

        // 3. 备选轮询 /api/history/{promptId} (当 jobs 状态有微小同步延迟时)
        if (!job || !job.outputs || Object.keys(job.outputs).length === 0) {
          const histRes = await this.dispatchHttp({
            url: `${this.baseUrl}/api/history/${promptId}`,
            method: 'GET',
            headers: apiKey ? { 'X-API-Key': apiKey, 'Authorization': `Bearer ${apiKey}` } : {},
            signal,
          });
          if (histRes.ok && histRes.data) {
            const histData = histRes.data[promptId] || histRes.data;
            if (histData?.outputs && Object.keys(histData.outputs).length > 0) {
              onProgress?.(92, '计算完成，正在下载产物数据...');
              return await this.extractArtifactFromJob(config, histData, promptId, apiKey);
            }
          }
        }
      } catch (pollErr: any) {
        if (pollErr.name === 'AbortError') throw new Error('生成作业已被用户取消');
        if (pollErr.message && !pollErr.message.includes('fetch')) throw pollErr;
      }

      // 渐进式等待反馈
      if (currentPercent < 90) {
        currentPercent += 5;
        onProgress?.(currentPercent, `GPU 正在渲染中 (${Math.round((Date.now() - startTime) / 1000)}s)...`);
      }
    }

    throw new Error(`生成超时（超过 ${timeoutMs / 1000} 秒）`);
  }

  private async dispatchHttp(options: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    signal?: AbortSignal;
  }): Promise<{ ok: boolean; status: number; data?: any; error?: string; dataBase64?: string }> {
    const { url, method = 'GET', headers = {}, body, signal } = options;

    if (typeof window !== 'undefined' && (window as any).graphvideoDesktop?.audioStudio?.dispatch) {
      const res = await (window as any).graphvideoDesktop.audioStudio.dispatch({
        url,
        method,
        headers,
        body,
      });
      return res;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal,
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    }
    const text = await res.text();
    return { ok: res.ok, status: res.status, error: text };
  }

  private async extractArtifactFromJob(
    config: ComfyUiWorkflowConfig,
    job: any,
    promptId: string,
    apiKey?: string
  ): Promise<GeneratedArtifact> {
    const outputs = job.outputs || job.output || {};
    for (const nodeId of Object.keys(outputs)) {
      const nodeOutput = outputs[nodeId];
      if (nodeOutput.images && nodeOutput.images.length > 0) {
        const img = nodeOutput.images[0];
        const mediaUrl = `${this.baseUrl}/api/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`;
        let base64: string | undefined;
        try {
          const downloadRes = await this.dispatchHttp({
            url: mediaUrl,
            headers: apiKey ? { 'X-API-Key': apiKey, 'Authorization': `Bearer ${apiKey}` } : {},
          });
          if (downloadRes.ok && downloadRes.dataBase64) {
            base64 = downloadRes.dataBase64;
          }
        } catch {}

        return {
          kind: 'image',
          url: mediaUrl,
          filename: img.filename,
          base64,
          timestamp: Date.now(),
        };
      }
      if (nodeOutput.videos && nodeOutput.videos.length > 0) {
        const vid = nodeOutput.videos[0];
        const mediaUrl = `${this.baseUrl}/api/view?filename=${encodeURIComponent(vid.filename)}&subfolder=${encodeURIComponent(vid.subfolder || '')}&type=${encodeURIComponent(vid.type || 'output')}`;
        let base64: string | undefined;
        try {
          const downloadRes = await this.dispatchHttp({
            url: mediaUrl,
            headers: apiKey ? { 'X-API-Key': apiKey, 'Authorization': `Bearer ${apiKey}` } : {},
          });
          if (downloadRes.ok && downloadRes.dataBase64) {
            base64 = downloadRes.dataBase64;
          }
        } catch {}

        return {
          kind: 'video',
          url: mediaUrl,
          filename: vid.filename,
          base64,
          timestamp: Date.now(),
        };
      }
      if (nodeOutput.gifs && nodeOutput.gifs.length > 0) {
        const gif = nodeOutput.gifs[0];
        const mediaUrl = `${this.baseUrl}/api/view?filename=${encodeURIComponent(gif.filename)}&subfolder=${encodeURIComponent(gif.subfolder || '')}&type=${encodeURIComponent(gif.type || 'output')}`;
        let base64: string | undefined;
        try {
          const downloadRes = await this.dispatchHttp({
            url: mediaUrl,
            headers: apiKey ? { 'X-API-Key': apiKey, 'Authorization': `Bearer ${apiKey}` } : {},
          });
          if (downloadRes.ok && downloadRes.dataBase64) {
            base64 = downloadRes.dataBase64;
          }
        } catch {}

        return {
          kind: 'video',
          url: mediaUrl,
          filename: gif.filename,
          base64,
          timestamp: Date.now(),
        };
      }
    }

    if (job.preview_output) {
      const preview = job.preview_output;
      const mediaUrl = `${this.baseUrl}/api/view?filename=${encodeURIComponent(preview.filename)}&type=${encodeURIComponent(preview.type || 'output')}`;
      let base64: string | undefined;
      try {
        const downloadRes = await this.dispatchHttp({
          url: mediaUrl,
          headers: apiKey ? { 'X-API-Key': apiKey, 'Authorization': `Bearer ${apiKey}` } : {},
        });
        if (downloadRes.ok && downloadRes.dataBase64) {
          base64 = downloadRes.dataBase64;
        }
      } catch {}

      return {
        kind: (config.mediaType as 'image' | 'video' | 'audio') || 'image',
        url: mediaUrl,
        filename: preview.filename,
        base64,
        timestamp: Date.now(),
      };
    }

    return {
      kind: (config.mediaType as 'image' | 'video' | 'audio') || 'image',
      url: `${this.baseUrl}/api/view?prompt_id=${promptId}`,
      filename: `${config.id}-${promptId}`,
      timestamp: Date.now(),
    };
  }
}

// 导出默认客户端单例
export const defaultComfyCloudClient = new ComfyCloudClient(
  'COMFY_CLOUD_API_KEY_REDACTED',
  'https://cloud.comfy.org'
);
