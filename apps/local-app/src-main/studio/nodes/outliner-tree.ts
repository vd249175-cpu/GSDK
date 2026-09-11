import { Node } from '@graphvideo/kernel';
import type { Info, DomainChangeContext } from '@graphvideo/kernel';
import type { ProjectTreeItem } from '../domain/types';
import { editProjectTree, flattenProjectTree, type ProjectTreeEditOperation, } from '../domain/outliner/tree-editor';
export interface OutlinerState {
    tree: ProjectTreeItem[];
    lastStructureMd: string;
}
export class OutlinerTreeNode extends Node<OutlinerState> {
    constructor(id: string = 'node-outliner', name: string = '大纲层级管理器') {
        super(id, name, {
            tree: [],
            lastStructureMd: '',
        });
        this.icon = '📋';
        this.description =
            '【大纲唯一 Owner】维护 canonical ProjectTreeItem\n【树编辑计算】基于 MarkdownSource revision 计算文档替换\n【提交闭环】替换请求返回 MarkdownSource，由 Kernel 重跑解析并投影';
    }
    protected override async change(info: Info, ctx: DomainChangeContext<OutlinerState>): Promise<void> {
        if (info.type === 'ProjectTreeEditTaskInfo') {
            if (typeof info.markdown !== 'string' ||
                !Number.isSafeInteger(info.baseRevision)) {
                throw new Error('ProjectTreeEditTaskInfo 缺少 markdown/baseRevision');
            }
            if (!info.operation || typeof info.operation !== 'object') {
                throw new Error('ProjectTreeEditTaskInfo 缺少 canonical operation');
            }
            const operation = info.operation as ProjectTreeEditOperation;
            const markdown = String(info.markdown);
            const edited = await ctx.span('edit_project_tree', () => editProjectTree(markdown, operation));
            if (edited.markdown === markdown)
                return;
            const replacement = {
                type: 'ProjectDocumentReplacementInfo',
                markdown: edited.markdown,
                baseRevision: info.baseRevision,
                persistenceMode: operation.type === 'move' ||
                    operation.type === 'adjust-depth' ||
                    operation.type === 'paste'
                    ? 'order'
                    : 'structure',
                preferredNodeId: edited.preferredNodeId,
            };
            ctx.send(replacement, 'node-md-source');
            return;
        }
        if (info.type !== 'ParsedAstTreeInfo' || !Array.isArray(info.tree))
            return;
        const nextTree = info.tree as ProjectTreeItem[];
        const structureMarkdown = typeof info.markdown === 'string'
            ? info.markdown
            :
                ctx.read('lastStructureMd');
        const now = this.runtimeNow();
        {
            ctx.write('tree', nextTree);
            ctx.write('lastStructureMd', structureMarkdown);
            ctx.send({
                type: 'StructureMarkdownInfo',
                structureMd: structureMarkdown,
            }, 'node-sec-gate');
            ctx.send({
                type: 'StateToCaptureInfo',
                tree: nextTree,
                structureMd: structureMarkdown,
            }, 'n-hist');
            return;
        }
    }
    public getBodySummaryText(): string {
        const totalNodes = flattenProjectTree(this.state.tree).length;
        return totalNodes > 0
            ? `大纲树: ${totalNodes} 个项目项`
            : this.description || '大纲树就绪';
    }
}
export { OutlinerTreeNode as ProjectOutlineNode };
