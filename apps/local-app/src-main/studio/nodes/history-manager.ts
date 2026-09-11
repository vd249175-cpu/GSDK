import { Node } from '@graphvideo/kernel';
import type { Info, DomainChangeContext } from '@graphvideo/kernel';
import type { NodeMetadataRecord } from './sqlite-registry';
export interface HistoryAction {
    type: 'CAPTURE' | 'UNDO' | 'REDO' | 'CLEAR_REDO';
    label?: string;
    payload?: any;
}
export interface ActionJournalEntry {
    id: string;
    timestamp: number;
    op: 'INSERT' | 'UPDATE' | 'DELETE' | 'BATCH';
    targetId: string;
    label?: string;
    before: NodeMetadataRecord | null;
    after: NodeMetadataRecord | null;
}
export interface HistoryState {
    past: ActionJournalEntry[];
    future: ActionJournalEntry[];
    currentEntry: ActionJournalEntry | null;
    historyScopeId: string;
}
export class HistoryManagerNode extends Node<HistoryState> {
    constructor(id: string = 'n-hist', name: string = '事实历史与回滚中枢') {
        super(id, name, {
            past: [],
            future: [],
            currentEntry: null,
            historyScopeId: '',
        });
        this.icon = '⏳';
        this.description =
            '【事实历史记录】维护不可变数据库原子变更日志 (Action Journal)\n【事务级回滚】向 SQLite 发送 RevertMetadataTaskInfo 执行行级回滚\n【单向因果】无跨域倒灌，保持 100% 纯正向无环因果流水线';
    }
    public async recordJournal(entry: Omit<ActionJournalEntry, 'id' | 'timestamp'>, ctx: DomainChangeContext<HistoryState>): Promise<void> {
        const fullEntry: ActionJournalEntry = {
            ...entry,
            id: this.runtimeId('snapshot'),
            timestamp: this.runtimeNow(),
        };
        {
            const past = ctx.read('past');
            ctx.write('past', [...past, fullEntry]);
            ctx.write('future', []);
            ctx.write('currentEntry', fullEntry);
        }
    }
    protected override async change(info: Info, ctx: DomainChangeContext<HistoryState>): Promise<void> {
        if (info.type === 'ProjectHistoryResetInfo') {
            ctx.patchState({ past: [], future: [], currentEntry: null, historyScopeId: String(info.historyScopeId) });
            return;
        }
        if (info.type === 'TaskFactObservedInfo') {
            if ((info.historyScopeId ?? '') !== ctx.read('historyScopeId')) return;
            const fact = info.fact as Omit<ActionJournalEntry, 'id' | 'timestamp'> | undefined;
            if (fact) {
                await this.recordJournal(fact, ctx);
            }
            return;
        }
        if (info.type === 'UserSnapshotActionInfo') {
            const action = (info.action as HistoryAction | undefined)?.type;
            if (action === 'CLEAR_REDO') {
                ctx.write('future', []);
                return;
            }
            if (action === 'UNDO') {
                const past = [...ctx.read('past')];
                const future = [...ctx.read('future')];
                if (past.length === 0)
                    return;
                const entry = past.pop()!;
                future.push(entry);
                {
                    ctx.write('past', past);
                    ctx.write('future', future);
                    ctx.write('currentEntry', past.length > 0 ? past[past.length - 1] : null);
                    ctx.send({
                        type: 'RevertMetadataTaskInfo',
                        entry,
                        direction: 'undo',
                        historyScopeId: ctx.read('historyScopeId'),
                    }, 'node-sqlite');
                }
            }
            else if (action === 'REDO') {
                const past = [...ctx.read('past')];
                const future = [...ctx.read('future')];
                if (future.length === 0)
                    return;
                const entry = future.pop()!;
                past.push(entry);
                {
                    ctx.write('past', past);
                    ctx.write('future', future);
                    ctx.write('currentEntry', entry);
                    ctx.send({
                        type: 'RevertMetadataTaskInfo',
                        entry,
                        direction: 'redo',
                        historyScopeId: ctx.read('historyScopeId'),
                    }, 'node-sqlite');
                }
            }
        }
    }
    public getBodySummaryText(): string {
        const p = this.state.past.length;
        const f = this.state.future.length;
        return `日志: [撤销栈: ${p}] [重做栈: ${f}]`;
    }
}
