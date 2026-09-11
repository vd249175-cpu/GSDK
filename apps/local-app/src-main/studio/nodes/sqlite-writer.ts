import { WorldNode } from '@graphvideo/kernel';
import type { Info, WorldChangeContext } from '@graphvideo/kernel';
import type { EffectAdapter } from '@graphvideo/kernel';
import { SqliteMetadataAdapter, type SqliteMetadataRecord, type SqlitePersistObservation, type SqlitePersistRequest, } from '../effects/sqlite-metadata-adapter';
import { DesktopSqliteWritePort } from '../effects/desktop-sqlite-write-port';
import { ProjectStructureAdapter, type ProjectStructurePersistObservation, type ProjectStructurePersistRequest, } from '../effects/project-structure-adapter';
import { DesktopProjectStructureWritePort } from '../effects/desktop-project-structure-write-port';
export interface SqliteWriterState {
    persistedRecordCount: number;
    dbFilePath: string;
    lastPersistTime: number;
}
export class SqliteWriterSinkNode extends WorldNode<SqliteWriterState> {
    constructor(id: string = 'sink-sqlite-writer', name: string = 'SQLite磁盘写入端', private readonly adapter: EffectAdapter<SqlitePersistRequest, SqlitePersistObservation> = new SqliteMetadataAdapter(new DesktopSqliteWritePort()), private readonly projectStructureAdapter: EffectAdapter<ProjectStructurePersistRequest, ProjectStructurePersistObservation> = new ProjectStructureAdapter(new DesktopProjectStructureWritePort()), private readonly observerTargetId: string = 'src-sqlite-observer') {
        super(id, name, {
            persistedRecordCount: 0,
            dbFilePath: '.graphvideo/nodes.sqlite',
            lastPersistTime: 0,
        });
        this.icon = '💾';
        this.description =
            '【物理写入执行端】独占执行 SQLite 本地磁盘事务与持久化写入\n【单向受控】接收 SqliteRegistryNode 下发的元数据与文本落盘任务\n【物理流出】落盘完成后触发物理层事实至落盘观测端';
    }
    protected override async change(info: Info, ctx: WorldChangeContext<SqliteWriterState>): Promise<void> {
        if (info.type === 'PersistProjectStructureTaskInfo') {
            const request = info.request as ProjectStructurePersistRequest | undefined;
            if (!request)
                throw new Error('PersistProjectStructureTaskInfo 缺少 request');
            const now = this.runtimeNow();
            let observation: ProjectStructurePersistObservation;
            try {
                observation = await ctx.effectAdapter(this.projectStructureAdapter, request);
            }
            catch (error) {
                ctx.send({
                    type: 'DatabaseWriteFailedObservedInfo',
                    taskId: request.taskId,
                    adapterId: this.projectStructureAdapter.id,
                    error: error instanceof Error ? error.message : String(error),
                }, this.observerTargetId);
                return;
            }
            ctx.write('persistedRecordCount', observation.nodes.length);
            ctx.write('lastPersistTime', now);
            const observed = {
                type: 'PhysicalProjectStructureMutationInfo',
                taskId: request.taskId,
                observation,
            };
            ctx.send(observed, this.observerTargetId);
            return;
        }
        if (info.type === 'PersistMetadataTaskInfo' ||
            info.type === 'SyncTreeInfo') {
            const rawRecords = info.type === 'PersistMetadataTaskInfo'
                ? info.records
                : info.nodes;
            const records = (rawRecords instanceof Map
                ? [...rawRecords.values()]
                : Array.isArray(rawRecords)
                    ? rawRecords
                    : [rawRecords]).filter((record): record is SqliteMetadataRecord => Boolean(record) &&
                typeof record === 'object' &&
                typeof record.id === 'string');
            const now = this.runtimeNow();
            const dbPath = ctx.read('dbFilePath');
            const taskId = typeof info.taskId === 'string' ? info.taskId : undefined;
            const request: SqlitePersistRequest = {
                taskId,
                dbFilePath: dbPath,
                records,
            };
            let observation: SqlitePersistObservation;
            try {
                {
                    observation = await ctx.effectAdapter(this.adapter, request);
                }
            }
            catch (error) {
                const failureInfo: Info = {
                    type: 'DatabaseWriteFailedObservedInfo',
                    taskId,
                    adapterId: this.adapter.id,
                    error: error instanceof Error ? error.message : String(error),
                };
                ctx.send(failureInfo, this.observerTargetId);
                return;
            }
            {
                ctx.write('persistedRecordCount', observation.persistedRecordCount);
                ctx.write('lastPersistTime', now);
                ctx.send({
                    type: 'PhysicalDiskMutationInfo',
                    taskId,
                    dbFilePath: observation.dbFilePath,
                    persistedRecordCount: observation.persistedRecordCount,
                    observation,
                }, this.observerTargetId);
            }
        }
    }
    public getBodySummaryText(): string {
        return this.state.persistedRecordCount > 0
            ? `已落盘: ${this.state.persistedRecordCount} 条记录 (${this.state.dbFilePath})`
            : this.description;
    }
}
