import type { ComfyUiWorkflowConfig } from '../types';
// @ts-ignore
import { applyComfyUiBindings } from '../../../shared/comfyui/workflow.mjs';

/**
 * 纯逻辑：ComfyUI 工作流参数绑定、Graph 变异与 Prompt Payload 构建引擎
 */
export class ComfyUiWorkflowEngine {
  /**
   * 应用参数绑定到 ComfyUI 图定义副本中
   */
  public static applyBindings(
    config: ComfyUiWorkflowConfig,
    values: Record<string, any> = {}
  ): Record<string, any> {
    try {
      return applyComfyUiBindings(config as any, values);
    } catch {
      const graphCopy = JSON.parse(JSON.stringify(config.graph));
      const mergedValues = { ...(config.defaults || {}), ...values };

      for (const [bindingName, binding] of Object.entries(config.bindings || {})) {
        if (mergedValues[bindingName] === undefined) continue;

        const targetVal = mergedValues[bindingName];
        const targetNodeId = binding.node;
        const targetInputKey = binding.input;

        if (!graphCopy[targetNodeId]) continue;

        if (binding.kind === 'scalar' || !binding.kind) {
          graphCopy[targetNodeId].inputs[targetInputKey] = targetVal;
        }
      }
      return graphCopy;
    }
  }

  /**
   * 构建发送至 ComfyUI /prompt 的完整请求体
   */
  public static buildPromptPayload(
    config: ComfyUiWorkflowConfig,
    values: Record<string, any> = {},
    clientId: string = 'gv-client-1'
  ) {
    const promptGraph = this.applyBindings(config, values);
    return {
      client_id: clientId,
      prompt: promptGraph
    };
  }
}
