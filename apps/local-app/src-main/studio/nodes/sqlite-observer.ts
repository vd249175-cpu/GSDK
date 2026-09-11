import { WorldNode } from '@graphvideo/kernel';
import type { Info, WorldChangeContext } from '@graphvideo/kernel';
export interface SqliteObserverState {
    observedFlushes: number;
    lastFlushedBytes: number;
    lastObservedTime: number;
}
export class SqliteObserverSourceNode extends WorldNode<SqliteObserverState> {
    constructor(id: string = 'src-sqlite-observer', name: string = 'SQLite落盘观测源') {
        super(id, name, {
            observedFlushes: 0,
            lastFlushedBytes: 0,
            lastObservedTime: 0,
        });
        this.icon = '📡';
        this.description =
            '【现实观测源】独立捕获 SQLite 物理磁盘落库完成事实\n【事实提升】物理写入事件 -> DatabaseSavedObservedInfo\n【对账回流】单向回流至领域层完成预期与事实闭环核验';
    }
    protected override async change(info: Info, ctx: WorldChangeContext<SqliteObserverState>): Promise<void> {
        if (info.type === 'DatabaseWriteFailedObservedInfo') {
            ctx.write('lastObservedTime', this.runtimeNow());
            ctx.send(info, 'node-sqlite');
            return;
        }
        if (info.type === 'PhysicalDiskMutationInfo' ||
            info.type === 'PhysicalProjectStructureMutationInfo' ||
            info.persistedRecordCount !== undefined) {
            const projectObservation = info.type === 'PhysicalProjectStructureMutationInfo'
                ? info.observation as { nodes: unknown[] }
                : null;
            const count = projectObservation?.nodes?.length ?? Number(info.persistedRecordCount ?? 0);
            const now = this.runtimeNow();
            const observedInfo: Info = projectObservation
                ? {
                    type: 'ProjectStructurePersistedObservedInfo',
                    taskId: info.taskId,
                    observation: projectObservation,
                }
                : {
                    type: 'DatabaseSavedObservedInfo',
                    taskId: info.taskId,
                    dbFilePath: info.dbFilePath || 'dist/project.sqlite',
                    persistedRecordCount: count,
                    observation: info.observation,
                };
            {
                const prevFlushes = ctx.read('observedFlushes');
                ctx.write('observedFlushes', prevFlushes + 1);
                ctx.write('lastFlushedBytes', count * 64);
                ctx.write('lastObservedTime', now);
                ctx.send(observedInfo, 'node-sqlite');
            }
        }
    }
    public getBodySummaryText(): string {
        return this.state.observedFlushes > 0
            ? `已捕获落盘事实: ${this.state.observedFlushes} 次`
            : this.description;
    }
}
