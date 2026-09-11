import { Node } from '@graphvideo/kernel';
import type { Info, DomainChangeContext } from '@graphvideo/kernel';
import type {
    ArtifactSavedObservedInfo,
    GenerationBatchPlannedInfo,
    GenerationSubmitBatchRequestedInfo,
    GenerationBudgetConfiguredInfo,
    GenerationCreditsResetInfo,
} from '../protocol';
export interface SecurityGateOptions {
    maxCreditBudget?: number;
}
export interface GenerationDecisionState {
    spentCredits: number;
    maxCreditBudget: number;
    lastBlockReason: string | null;
    lastVerifiedArtifact: any | null;
}
export class SecurityGateNode extends Node<GenerationDecisionState> {
    constructor(id: string = 'node-sec-gate', name: string = '风控与预算关口', options: SecurityGateOptions = {}) {
        super(id, name, {
            spentCredits: 0,
            maxCreditBudget: options.maxCreditBudget ?? 10000,
            lastBlockReason: null,
            lastVerifiedArtifact: null,
        });
        this.category = 'decision';
        this.icon = '🛡️';
        this.description =
            '【预算 Owner】按解析后的模型计划核算并签发批次\n【准入决策】预算不足时拒绝进入生成任务状态机\n【事实核销】接收物理落盘 Observation 并转交 SQLite';
    }
    protected override async change(info: Info, ctx: DomainChangeContext<GenerationDecisionState>): Promise<void> {
        if (info.type === 'GenerationBudgetConfiguredInfo') {
            const configured = info as GenerationBudgetConfiguredInfo;
            if (!Number.isFinite(configured.maxBudget) || configured.maxBudget < 0) {
                throw new Error('生成预算必须是非负有限数值');
            }
            ctx.write('maxCreditBudget', configured.maxBudget);
            ctx.write('lastBlockReason', null);
            return;
        }
        if (info.type === 'GenerationCreditsResetInfo') {
            void (info as GenerationCreditsResetInfo);
            ctx.write('spentCredits', 0);
            ctx.write('lastBlockReason', null);
            return;
        }
        if (info.type === 'GenerationBatchPlannedInfo') {
            const planned = info as GenerationBatchPlannedInfo;
            // All plans pass the task Owner's target admission before budget accounting.
            ctx.send(planned, 'node-generation-task');
            return;
        }
        if (info.type === 'GenerationSubmitBatchRequestedInfo') {
            const planned = info as GenerationSubmitBatchRequestedInfo;
            const cost = planned.tasks.reduce((sum, task) => sum + task.estimatedCredits, 0);
            const currentSpent = ctx.read('spentCredits');
            const maxBudget = ctx.read('maxCreditBudget');
            if (!Number.isFinite(cost) || cost < 0 || currentSpent + cost > maxBudget) {
                const reason = `拦截：本批需 ${cost} 积分，已消耗 ${currentSpent}，超过预算 ${maxBudget} 或积分无效`;
                ctx.write('lastBlockReason', reason);
                ctx.send({
                    type: 'GenerationBatchSubmittedObservedInfo',
                    batchId: planned.batchId,
                    results: planned.tasks.map((task) => ({
                        taskId: task.taskId, ok: false, provider: task.submit.provider, error: reason,
                    })),
                }, 'node-generation-task');
                return;
            }
            ctx.write('spentCredits', currentSpent + cost);
            ctx.write('lastBlockReason', null);
            ctx.send(planned, 'sink-generation-submit');
            return;
        }
        if (info.type === 'ArtifactSavedObservedInfo' && info.relativePath) {
            const observed = info as ArtifactSavedObservedInfo;
            {
                ctx.write('lastVerifiedArtifact', {
                    id: observed.versionId,
                    name: observed.filename,
                    filename: observed.filename,
                    kind: observed.mediaType,
                    type: observed.mediaType,
                    url: observed.relativePath,
                });
                ctx.send(observed, 'node-sqlite');
            }
            return;
        }
    }
    public getSpentCredits(): number {
        return this.state.spentCredits;
    }
    public getMaxCreditBudget(): number {
        return this.state.maxCreditBudget;
    }
    public getLastBlockReason(): string | null {
        return this.state.lastBlockReason;
    }
    public getBodySummaryText(): string {
        return this.state.lastBlockReason
            ? `风控拦截: ${this.state.lastBlockReason}`
            : this.description ||
                `积分放行: ${this.state.spentCredits}/${this.state.maxCreditBudget}`;
    }
}
export { SecurityGateNode as GenerationDecisionNode };
