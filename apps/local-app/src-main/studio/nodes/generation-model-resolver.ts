import { Node } from '@graphvideo/kernel';
import type { ChangeContext, Info } from '@graphvideo/kernel';
import { buildModelRequestV2, compileModelIntentV2 } from '../../shared/generation-model-intent-v2.mjs';
import { planGenerationBatch } from '../../shared/generation-batch-planner.mjs';
import { compileGenerationSubmitSpecV2 } from '../../shared/generation-submit-spec-v2.mjs';
import { parseGenerationPrompt } from '../../shared/generation-prompt.mjs';
import type { GenerationAdapterSubmitSpec } from '../effects/generation-adapter-operation';
import type {
  GenerationBatchRequestedInfo,
  GenerationBatchPlannedInfo,
  GenerationModelResolutionCompletedInfo,
  GenerationModelResolutionFailedInfo,
  GenerationModelResolutionRequestedInfo,
} from '../protocol';

export interface GenerationModelResolutionRecord {
  readonly requestId: string;
  readonly status: 'resolved' | 'failed';
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly error: string;
}

export interface GenerationModelResolverState {
  readonly resolutions: Map<string, GenerationModelResolutionRecord>;
}

function requestedSnapshot(catalog: GenerationBatchRequestedInfo['catalog'], prompt: string) {
  const requestedModelId = parseGenerationPrompt(prompt).modelId;
  const snapshot = catalog.models.find((entry) => (
    entry.model.id === requestedModelId || entry.model.aliases.includes(requestedModelId ?? '')
  ));
  if (!snapshot) throw new Error(`批次快照缺少模型: ${requestedModelId ?? 'unknown'}`);
  return snapshot;
}

function checkedMaxGenerationWaitMs(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0 || value > 24 * 60 * 60 * 1_000) {
    throw new Error('最大生成等待时间必须在 0 到 1440 分钟之间');
  }
  return Math.round(value);
}

export class GenerationModelResolverNode extends Node<GenerationModelResolverState> {
  constructor(
    id: string = 'node-generation-model-resolver',
    name: string = '生成模型解析器',
    private readonly resolutionResultTargetId: string = 'node-generation-task',
    private readonly batchAdmissionTargetId: string = 'node-generation-task',
  ) {
    super(id, name, { resolutions: new Map() });
    this.icon = '🧩';
    this.description = '模型声明、参数、提示词与依赖规则的纯业务 Owner；不执行请求、轮询、下载或项目 I/O';
  }

  protected override async change(
    info: Info,
    ctx: ChangeContext<GenerationModelResolverState>,
  ): Promise<void> {
    if (info.type === 'GenerationBatchRequestedInfo') {
      const requested = info as GenerationBatchRequestedInfo;
      const maxGenerationWaitMs = checkedMaxGenerationWaitMs(requested.maxGenerationWaitMs);
      const plan = planGenerationBatch(requested.project, requested.items, {
        batchId: requested.batchId,
        audioUrl: requested.audioUrl,
        nextId: () => this.runtimeId('task'),
      });
      const tasks = plan.tasks.map((task) => {
        const snapshot = requestedSnapshot(requested.catalog, task.input.prompt);
        const submit = compileGenerationSubmitSpecV2(
          buildModelRequestV2(snapshot, task.input),
          plan.project,
        ) as GenerationAdapterSubmitSpec;
        return {
          taskId: task.taskId,
          targetNodeId: task.targetNodeId,
          versionId: task.versionId,
          mediaType: task.mediaType,
          estimatedCredits: compileModelIntentV2(snapshot, task.input).estimatedCredits,
          destinationRelativePath: task.destinationRelativePath,
          autoPoll: true,
          maxGenerationWaitMs,
          submit,
        };
      });
      const plannedInfo: GenerationBatchPlannedInfo = {
        type: 'GenerationBatchPlannedInfo',
        batchId: requested.batchId,
        tasks,
      };
      ctx.send(plannedInfo, this.batchAdmissionTargetId);
      return;
    }
    if (info.type !== 'GenerationModelResolutionRequestedInfo') return;
    const requested = info as GenerationModelResolutionRequestedInfo;
    const next = new Map(ctx.read('resolutions'));
    try {
      const result = buildModelRequestV2(
        requestedSnapshot(requested.catalog, requested.input.prompt),
        requested.input,
      );
      next.set(requested.requestId, {
        requestId: requested.requestId,
        status: 'resolved',
        result,
        error: '',
      });
      ctx.write('resolutions', next);
      const completedInfo: GenerationModelResolutionCompletedInfo = {
        type: 'GenerationModelResolutionCompletedInfo',
        requestId: requested.requestId,
        result,
      };
      ctx.send(completedInfo, this.resolutionResultTargetId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      next.set(requested.requestId, {
        requestId: requested.requestId,
        status: 'failed',
        result: null,
        error: message,
      });
      ctx.write('resolutions', next);
      const failedInfo: GenerationModelResolutionFailedInfo = {
        type: 'GenerationModelResolutionFailedInfo',
        requestId: requested.requestId,
        error: message,
      };
      ctx.send(failedInfo, this.resolutionResultTargetId);
    }
  }
}
