import { Node } from '@graphvideo/kernel';
import type { Info, DomainChangeContext } from '@graphvideo/kernel';
import type { AstNode, ProjectNode } from '../domain/types';
import type { ProjectStructurePersistMode, ProjectStructurePersistRequest, } from '../effects/project-structure-adapter';
import type { ArtifactSavedObservedInfo } from '../protocol';
export interface NodeMetadataRecord extends ProjectNode {
    activeVersionId?: string;
    mediaUrl?: string;
    updatedAt: number;
}
export interface SqliteRegistryState {
    table: Map<string, NodeMetadataRecord>;
    retainedTable: Map<string, NodeMetadataRecord>;
    lastUpdatedAt: number;
    inSync: boolean;
    lastError: string | null;
    historyScopeId: string;
}
export class SqliteRegistryNode extends Node<SqliteRegistryState> {
    constructor(id: string = 'node-sqlite', name: string = 'SQLite 元数据注册表') {
        super(id, name, {
            table: new Map<string, NodeMetadataRecord>(),
            retainedTable: new Map<string, NodeMetadataRecord>(),
            lastUpdatedAt: 0,
            inSync: true,
            lastError: null,
            historyScopeId: '',
        });
        this.icon = '🗄️';
        this.description =
            '【SQLite 权威真理源】作为系统唯一权威真理源 (SSOT) 维护节点元数据与文本\n【多路汇聚】接收 AST 树同步、大纲变异与智能体工具链修改\n【事务执行】原子委托物理写入端落盘并联动 Action Journal 历史日志';
    }
    public exportState() {
        return {
            table: Array.from(this.state.table.entries()),
            retainedTable: Array.from(this.state.retainedTable.entries()),
        };
    }
    public getRecord(id: string): NodeMetadataRecord | undefined {
        return this.state.table.get(id);
    }
    public getAllRecords(): NodeMetadataRecord[] {
        return Array.from(this.state.table.values());
    }
    protected override async change(info: Info, ctx: DomainChangeContext<SqliteRegistryState>): Promise<void> {
        const now = this.runtimeNow();
        if (info.type === 'ProjectMetadataHydratedInfo') {
            const hydrated = info as Info & {
                observedAt?: number;
                nodes?: ProjectNode[];
                retainedNodes?: ProjectNode[];
            };
            const observedAt = Number.isFinite(hydrated.observedAt) ? hydrated.observedAt! : now;
            const historyScopeId = this.runtimeId('snapshot');
            const records = (nodes: ProjectNode[]) => new Map(nodes.map((node) => [
                node.id,
                {
                    ...node,
                    description: node.description ?? '',
                    updatedAt: observedAt,
                } satisfies NodeMetadataRecord,
            ]));
            ctx.patchState({
                table: records(Array.isArray(hydrated.nodes) ? hydrated.nodes : []),
                retainedTable: records(Array.isArray(hydrated.retainedNodes) ? hydrated.retainedNodes : []),
                lastUpdatedAt: observedAt,
                inSync: true,
                lastError: null,
                historyScopeId,
            });
            ctx.send({ type: 'ProjectHistoryResetInfo', historyScopeId }, 'n-hist');
            return;
        }
        if (info.type === 'DatabaseSavedObservedInfo' ||
            info.type === 'ProjectStructurePersistedObservedInfo') {
            {
                ctx.write('inSync', true);
                ctx.write('lastError', null);
            }
            if (info.type === 'DatabaseSavedObservedInfo') {
                ctx.send({ ...info, type: 'DatabaseSavedObservedInfo' }, 'node-generation-task');
            }
            return;
        }
        if (info.type === 'DatabaseWriteFailedObservedInfo') {
            ctx.write('inSync', false);
            ctx.write('lastError', typeof info.error === 'string'
                ? info.error
                : 'SQLite 物理写入失败');
            ctx.send({ ...info, type: 'DatabaseWriteFailedObservedInfo' }, 'node-generation-task');
            return;
        }
        let changed = false;
        const table = new Map(ctx.read('table'));
        const retainedTable = new Map(ctx.read('retainedTable'));
        let journalFact: any = null;
        if (info.type === 'SyncTreeInfo' && Array.isArray(info.nodes)) {
            const incoming = info.nodes as ProjectNode[];
            const previousByTypeTitle = new Map([...table.values(), ...retainedTable.values()].map((record) => [
                `${record.type}:${record.title}`,
                record,
            ]));
            const nextTable = new Map<string, NodeMetadataRecord>();
            for (const node of incoming) {
                const retainedConflict = retainedTable.get(node.id);
                if (retainedConflict &&
                    (retainedConflict.type !== node.type || retainedConflict.title !== node.title)) {
                    const lastError = `ID “${node.id}” 已由保留节点 “${retainedConflict.title}” 占用`;
                    {
                        ctx.write('inSync', false);
                        ctx.write('lastError', lastError);
                    }
                    return;
                }
                const previous = table.get(node.id) ??
                    retainedTable.get(node.id) ??
                    previousByTypeTitle.get(`${node.type}:${node.title}`);
                const isAutomaticId = node.id.startsWith('auto:') || node.id.startsWith('unmapped:');
                let effectiveId = previous?.id ?? node.id;
                if (!previous && isAutomaticId) {
                    const allocatedId = this.runtimeId('task')
                        .replace(/[^A-Za-z0-9_-]/g, '_')
                        .replace(/^_+|_+$/g, '');
                    effectiveId = `node_${allocatedId || 'generated'}`;
                }
                nextTable.set(effectiveId, {
                    ...node,
                    ...(previous ?? {}),
                    id: effectiveId,
                    type: node.type,
                    title: node.title,
                    description: node.description || previous?.description || '',
                    updatedAt: now,
                });
                retainedTable.delete(effectiveId);
            }
            for (const [id, previous] of table) {
                if (nextTable.has(id))
                    continue;
                const hasPayload = Boolean(previous.description ||
                    previous.content ||
                    previous.prompt ||
                    previous.mediaUrl ||
                    previous.history?.length);
                if (hasPayload)
                    retainedTable.set(id, previous);
            }
            table.clear();
            for (const [id, record] of nextTable)
                table.set(id, record);
            changed = true;
        }
        else if (info.type === 'SyncTreeInfo' && Array.isArray(info.tree)) {
            const syncNode = (n: AstNode) => {
                if (!table.has(n.id)) {
                    table.set(n.id, {
                        id: n.id,
                        type: n.type,
                        title: n.title,
                        description: '',
                        updatedAt: now,
                    });
                }
                for (const child of n.children)
                    syncNode(child);
            };
            for (const root of info.tree)
                syncNode(root);
            changed = true;
        }
        else if (info.type === 'ArtifactSavedObservedInfo' && typeof info.targetNodeId === 'string') {
            const observed = info as ArtifactSavedObservedInfo;
            const target = table.get(observed.targetNodeId);
            if (!target) {
                ctx.send({
                    type: 'DatabaseWriteFailedObservedInfo', taskId: observed.taskId,
                    error: `生成产物目标已不存在: ${observed.targetNodeId}`,
                }, 'node-generation-task');
                return;
            }
            if (target) {
                const prev = { ...target };
                const history = (target.history ?? []).map((version) => ({
                    ...version,
                    current: false,
                }));
                if (observed.versionId && observed.relativePath) {
                    const mimeType = observed.mediaType === 'image'
                        ? 'image/png'
                        : observed.mediaType === 'audio'
                            ? 'audio/mpeg'
                            : 'video/mp4';
                    history.push({
                        id: observed.versionId,
                        label: observed.filename || 'Generated Media',
                        relativePath: observed.relativePath,
                        mimeType,
                        createdAt: new Date(now).toISOString(),
                        source: 'generated',
                        current: true,
                    });
                }
                table.set(observed.targetNodeId, {
                    ...target,
                    mediaUrl: observed.relativePath || target.mediaUrl,
                    activeVersionId: observed.versionId || target.activeVersionId,
                    history,
                    updatedAt: now,
                });
                changed = true;
                journalFact = {
                    op: 'UPDATE',
                    targetId: observed.targetNodeId,
                    label: `关联生成产物: ${observed.filename || observed.targetNodeId}`,
                    before: prev,
                    after: table.get(observed.targetNodeId)!,
                };
            }
        }
        else if (info.type === 'UserMetadataPatchInfo' && info.patch) {
            const patch = info.patch as Partial<NodeMetadataRecord> & { id?: string; nodeId?: string };
            const targetId = patch.id || patch.nodeId;
            if (!targetId)
                return;
            const target = table.get(targetId);
            if (target) {
                const prev = { ...target };
                const updated = {
                    ...target,
                    ...patch,
                    updatedAt: now,
                };
                table.set(targetId, updated);
                changed = true;
                journalFact = {
                    op: 'UPDATE',
                    targetId,
                    label: `更新元数据: ${target.title}`,
                    before: prev,
                    after: updated,
                };
            }
        }
        else if (info.type === 'RevertMetadataTaskInfo' && info.entry) {
            if (info.historyScopeId !== ctx.read('historyScopeId')) return;
            const entry = info.entry as {
                targetId: string;
                before: NodeMetadataRecord | null;
                after: NodeMetadataRecord | null;
            };
            const targetState = info.direction === 'undo' ? entry.before : entry.after;
            if (targetState) {
                table.set(entry.targetId, targetState);
            }
            else {
                table.delete(entry.targetId);
            }
            changed = true;
        }
        if (changed) {
            const projectRequest: ProjectStructurePersistRequest | null = info.type === 'SyncTreeInfo' && typeof info.markdown === 'string'
                ? {
                    taskId: typeof info.taskId === 'string'
                        ? info.taskId
                        : `project-sync-${now}`,
                    markdown: info.markdown,
                    nodes: [...table.values()],
                    retainedNodes: [...retainedTable.values()],
                    mode: (info.persistenceMode ?? 'full') as ProjectStructurePersistMode,
                }
                : null;
            {
                ctx.write('table', table);
                ctx.write('retainedTable', retainedTable);
                ctx.write('lastUpdatedAt', now);
                ctx.write('inSync', false);
                ctx.write('lastError', null);
                ctx.send(projectRequest
                    ? {
                        type: 'PersistProjectStructureTaskInfo',
                        taskId: projectRequest.taskId,
                        request: projectRequest,
                    }
                    : {
                        type: 'PersistMetadataTaskInfo',
                        taskId: info.type === 'ArtifactSavedObservedInfo'
                            ? String(info.taskId)
                            : this.runtimeId('task'),
                        records: Array.from(table.values()),
                    }, 'sink-sqlite-writer');
                if (journalFact && info.type !== 'RevertMetadataTaskInfo') {
                    ctx.send({
                        type: 'TaskFactObservedInfo',
                        fact: journalFact,
                        historyScopeId: ctx.read('historyScopeId'),
                    }, 'n-hist');
                }
            }
        }
    }
    public getBodySummaryText(): string {
        const count = this.state.table.size;
        const syncStatus = this.state.inSync ? '已对齐' : '落盘排队中';
        return `元数据记录: ${count}项 [${syncStatus}]`;
    }
}
export { SqliteRegistryNode as ProjectMetadataNode };
