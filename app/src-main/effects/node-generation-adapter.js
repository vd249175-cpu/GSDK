// src-main/effects/node-generation-adapter.ts
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

// ../plugins/graphvideo.studio/backend/effects/generation-adapter-operation.ts
var generationAdapterOperationId = "graphvideo/generation-adapter-operation-v1";

// src-main/effects/node-generation-adapter.ts
var NodeGenerationAdapter = class {
  id = generationAdapterOperationId;
  getProjectRoot;
  comfyApiKey;
  comfyBaseUrl;
  audioBaseUrl;
  mockTasks = /* @__PURE__ */ new Map();
  constructor(options = {}) {
    this.getProjectRoot = options.getProjectRoot ?? (() => null);
    this.comfyApiKey = (options.comfyApiKey ?? process.env.COMFY_API_KEY ?? process.env.COMFY_CLOUD_API_KEY ?? "").trim();
    this.comfyBaseUrl = (options.comfyBaseUrl ?? process.env.COMFY_BASE_URL ?? "https://cloud.comfy.org").replace(/\/+$/, "");
    this.audioBaseUrl = (options.audioBaseUrl ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
  }
  getEffectiveApiKey() {
    if (this.comfyApiKey && this.comfyApiKey.trim()) return this.comfyApiKey.trim();
    const envKey = process.env.COMFY_API_KEY || process.env.COMFY_CLOUD_API_KEY;
    if (envKey && envKey.trim()) return envKey.trim();
    return "";
  }
  async execute(request, context) {
    if (request.operation === "submit") {
      return this.handleSubmit(request.spec, context);
    } else if (request.operation === "poll") {
      return this.handlePoll(request.handle, context);
    } else if (request.operation === "download") {
      return this.handleDownload(request.artifact, request.destinationRelativePath, context);
    }
    throw new Error(`\u4E0D\u652F\u6301\u7684\u751F\u6210\u64CD\u4F5C: ${request.operation}`);
  }
  async handleSubmit(spec, context) {
    if (spec.provider === "mock") {
      const taskId = `mock-${randomUUID()}`;
      this.mockTasks.set(taskId, { kind: spec.kind });
      return {
        operation: "submit",
        status: "submitted",
        handle: {
          provider: "mock",
          taskId,
          resultKind: "memory"
        }
      };
    }
    if (spec.provider === "comfy") {
      const apiKey = this.getEffectiveApiKey();
      if (!apiKey) {
        throw new Error("\u672A\u914D\u7F6E COMFY_API_KEY\uFF0C\u65E0\u6CD5\u5411 Comfy Cloud \u53D1\u8D77\u771F\u5B9E\u751F\u6210");
      }
      const promptGraph = structuredClone(spec.prompt);
      if (spec.uploads && spec.uploads.length > 0) {
        const projectRoot = this.getProjectRoot();
        for (const upload of spec.uploads) {
          const sourcePath = projectRoot ? resolveSafeProjectPath(projectRoot, upload.sourcePath) : resolve(upload.sourcePath);
          if (!existsSync(sourcePath)) {
            throw new Error(`\u5F85\u4E0A\u4F20\u53C2\u8003\u5A92\u4F53\u6587\u4EF6\u4E0D\u5B58\u5728: ${sourcePath}`);
          }
          const fileBuffer = readFileSync(sourcePath);
          const fileName = basename(sourcePath);
          const formData = new FormData();
          formData.append("image", new Blob([fileBuffer]), fileName);
          formData.append("overwrite", "true");
          const uploadRes = await fetch(`${this.comfyBaseUrl}/api/upload/image`, {
            method: "POST",
            headers: {
              "X-API-Key": apiKey,
              Authorization: `Bearer ${apiKey}`
            },
            body: formData,
            signal: context.signal
          });
          if (!uploadRes.ok) {
            const errText = await uploadRes.text().catch(() => "");
            throw new Error(`Comfy Cloud \u53C2\u8003\u8D44\u6E90\u4E0A\u4F20\u5931\u8D25 (${uploadRes.status}): ${errText}`);
          }
          const uploadResult = await uploadRes.json();
          const uploadedName = uploadResult.name || fileName;
          const targetNode = promptGraph[upload.nodeId];
          if (targetNode?.inputs) {
            targetNode.inputs[upload.inputName] = uploadedName;
          }
        }
      }
      const response = await fetch(`${this.comfyBaseUrl}/api/prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          prompt: promptGraph,
          client_id: spec.clientId || `gv-client-${randomUUID()}`,
          extra_data: {
            api_key_comfy_org: apiKey,
            workflow_type: spec.workflowType,
            ...spec.extraData || {}
          }
        }),
        signal: context.signal
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Comfy Cloud \u63D0\u4EA4\u5931\u8D25: ${response.status} ${errorText}`);
      }
      const data = await response.json();
      const taskId = data.prompt_id || `comfy-${randomUUID()}`;
      return {
        operation: "submit",
        status: "submitted",
        handle: {
          provider: "comfy",
          taskId,
          apiMode: "cloud"
        }
      };
    }
    if (spec.provider === "audio") {
      const baseUrl = spec.baseUrl || this.audioBaseUrl;
      const response = await fetch(`${baseUrl}/audio/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_type: spec.taskType,
          project_id: spec.projectId,
          payload: spec.payload
        }),
        signal: context.signal
      });
      if (!response.ok) {
        const err = await response.text().catch(() => "");
        throw new Error(`Audio Gateway \u63D0\u4EA4\u5931\u8D25: ${response.status} ${err}`);
      }
      const data = await response.json();
      return {
        operation: "submit",
        status: "submitted",
        handle: {
          provider: "audio",
          taskId: data.task_id || `audio-${randomUUID()}`
        }
      };
    }
    throw new Error(`\u672A\u77E5\u751F\u6210 Provider: ${spec.provider}`);
  }
  async handlePoll(handle, context) {
    if (handle.provider === "mock") {
      const record = this.mockTasks.get(handle.taskId);
      if (!record) {
        return {
          operation: "poll",
          status: "failed",
          progress: 0,
          error: `Mock \u4EFB\u52A1\u672A\u627E\u5230: ${handle.taskId}`
        };
      }
      const ext = record.kind === "image" ? "png" : "mp4";
      return {
        operation: "poll",
        status: "ready",
        progress: 100,
        artifact: {
          provider: "mock",
          taskId: handle.taskId,
          kind: record.kind,
          filename: `${handle.taskId}.${ext}`,
          token: handle.taskId
        }
      };
    }
    if (handle.provider === "comfy") {
      const apiKey = this.getEffectiveApiKey();
      const headers = {
        ...apiKey ? { "X-API-Key": apiKey, Authorization: `Bearer ${apiKey}` } : {}
      };
      let outputs = {};
      try {
        const jobRes = await fetch(`${this.comfyBaseUrl}/api/jobs/${handle.taskId}`, {
          headers,
          signal: context.signal
        });
        if (jobRes.ok) {
          const job = await jobRes.json();
          if (job?.status && ["error", "non_retryable_error", "lost", "cancelled", "failed"].includes(job.status)) {
            return {
              operation: "poll",
              status: "failed",
              progress: 0,
              error: job.execution_error?.exception_message || job.error || `Comfy Cloud \u6267\u884C\u5931\u8D25 (${job.status})`
            };
          }
          if (job?.outputs && Object.keys(job.outputs).length > 0) {
            outputs = job.outputs;
          } else if (job?.output && Object.keys(job.output).length > 0) {
            outputs = job.output;
          }
        }
      } catch {
      }
      if (Object.keys(outputs).length === 0) {
        const response = await fetch(`${this.comfyBaseUrl}/api/history/${handle.taskId}`, {
          headers,
          signal: context.signal
        });
        if (response.ok) {
          const history = await response.json();
          const promptHistory = history[handle.taskId] || history;
          if (promptHistory?.outputs && Object.keys(promptHistory.outputs).length > 0) {
            outputs = promptHistory.outputs;
          }
        }
      }
      let foundFile = null;
      for (const nodeOutput of Object.values(outputs)) {
        const files = nodeOutput?.images || nodeOutput?.videos || nodeOutput?.gifs;
        if (Array.isArray(files) && files.length > 0) {
          foundFile = files[0];
          break;
        }
      }
      if (foundFile) {
        const ext = foundFile.filename.split(".").pop()?.toLowerCase() || "png";
        const isVideo = ext === "mp4" || ext === "webm";
        return {
          operation: "poll",
          status: "ready",
          progress: 100,
          artifact: {
            provider: "comfy",
            taskId: handle.taskId,
            kind: isVideo ? "video" : "image",
            filename: foundFile.filename,
            url: `${this.comfyBaseUrl}/api/view?filename=${encodeURIComponent(foundFile.filename)}&subfolder=${encodeURIComponent(foundFile.subfolder || "")}&type=${encodeURIComponent(foundFile.type || "output")}`
          }
        };
      }
      return {
        operation: "poll",
        status: "pending",
        progress: 50,
        remoteStatus: "executing"
      };
    }
    return {
      operation: "poll",
      status: "failed",
      progress: 0,
      error: `\u6682\u4E0D\u652F\u6301 Provider ${handle.provider} \u7684\u8F6E\u8BE2`
    };
  }
  async handleDownload(artifact, destinationRelativePath, context) {
    const projectRoot = this.getProjectRoot();
    const targetPath = projectRoot ? resolveSafeProjectPath(projectRoot, destinationRelativePath) : resolve(destinationRelativePath);
    const targetDir = dirname(targetPath);
    mkdirSync(targetDir, { recursive: true });
    const tempPath = `${targetPath}.tmp-${randomUUID()}`;
    try {
      if (artifact.provider === "mock") {
        const content = artifact.kind === "video" ? Buffer.from("FAKE_VIDEO_BINARY_STREAM_OUTPUT") : Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        writeFileSync(tempPath, content);
        renameSync(tempPath, targetPath);
        return {
          operation: "download",
          status: "downloaded",
          bytesWritten: content.length,
          destinationRelativePath,
          contentType: artifact.kind === "video" ? "video/mp4" : "image/png"
        };
      }
      if (!artifact.url) {
        throw new Error("\u4E0B\u8F7D\u4EA7\u7269\u7F3A\u5C11 remote URL");
      }
      const apiKey = this.getEffectiveApiKey();
      const response = await fetch(artifact.url, {
        headers: apiKey ? {
          "X-API-Key": apiKey,
          Authorization: `Bearer ${apiKey}`
        } : {},
        signal: context.signal,
        cache: "no-store"
        // 杜绝 Chromium 磁盘缓存锁
      });
      if (!response.ok || !response.body) {
        throw new Error(`\u4E0B\u8F7D\u5931\u8D25: ${response.status} ${response.statusText}`);
      }
      const fileStream = createWriteStream(tempPath);
      const nodeStream = Readable.fromWeb(response.body);
      let bytes = 0;
      nodeStream.on("data", (chunk) => {
        bytes += chunk.length;
      });
      await pipeline(nodeStream, fileStream);
      renameSync(tempPath, targetPath);
      return {
        operation: "download",
        status: "downloaded",
        bytesWritten: bytes,
        destinationRelativePath,
        contentType: response.headers.get("content-type") || "application/octet-stream"
      };
    } catch (error) {
      try {
        unlinkSync(tempPath);
      } catch {
      }
      throw error;
    }
  }
};
function resolveSafeProjectPath(projectRoot, candidate) {
  const root = resolve(projectRoot);
  const target = resolve(root, candidate);
  const nested = target.slice(root.length);
  if (!target.startsWith(root) || nested.length > 0 && !nested.startsWith(sep)) {
    throw new Error("\u76EE\u6807\u8DEF\u5F84\u8D85\u51FA\u9879\u76EE\u5B89\u5168\u8FB9\u754C");
  }
  return target;
}
export {
  NodeGenerationAdapter
};
