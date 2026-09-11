import { Node } from '@graphvideo/kernel';
import type { Info, DomainChangeContext } from '@graphvideo/kernel';
export interface MarkdownSourceState {
    markdown: string;
    revision: number;
    lastUpdatedAt: number;
}
export class MarkdownSourceNode extends Node<MarkdownSourceState> {
    constructor(id: string = 'node-md-source', name: string = 'Markdown 文本源', initialMd: string = '') {
        super(id, name, {
            markdown: initialMd,
            revision: 0,
            lastUpdatedAt: 0,
        });
        this.icon = '📄';
        this.description =
            '【文档投影视窗】维护当前文档内存视图与 Markdown 编辑态\n【响应触发】接收前端编辑输入或外部导入同步流\n【增量传播】广播 DocumentUpdatedInfo 驱动 AST 解析与数据库同步';
    }
    protected override async change(info: Info, ctx: DomainChangeContext<MarkdownSourceState>): Promise<void> {
        const currentMarkdown = ctx.read('markdown');
        const storedRevision = ctx.read('revision');
        const currentRevision = Number.isSafeInteger(storedRevision)
            ? storedRevision
            : 0;
        if (info.type === 'ProjectTreeEditRequestedInfo') {
            const request = {
                type: 'ProjectTreeEditTaskInfo',
                operation: info.operation,
                markdown: currentMarkdown,
                baseRevision: currentRevision,
            };
            ctx.send(request, 'node-outliner');
            return;
        }
        if (info.type === 'UserMarkdownEditedInfo') {
            const md = String(info.markdown ?? '');
            const now = this.runtimeNow();
            const nextRevision = currentRevision + 1;
            {
                ctx.write('markdown', md);
                ctx.write('revision', nextRevision);
                ctx.write('lastUpdatedAt', now);
                ctx.send({
                    type: 'DocumentUpdatedInfo',
                    markdown: md,
                    revision: nextRevision,
                    persistenceMode: 'full',
                }, 'node-md-parser');
            }
            return;
        }
        if (info.type === 'ProjectFileObservedInfo') {
            const md = typeof info.content === 'string' ? info.content : '';
            const now = this.runtimeNow();
            const nextRevision = currentRevision + 1;
            {
                ctx.write('markdown', md);
                ctx.write('revision', nextRevision);
                ctx.write('lastUpdatedAt', now);
                ctx.send({
                    type: 'DocumentUpdatedInfo',
                    markdown: md,
                    revision: nextRevision,
                    persistenceMode: 'full',
                }, 'node-md-parser');
            }
            return;
        }
        if (info.type === 'ProjectDocumentReplacementInfo') {
            if (!Number.isSafeInteger(info.baseRevision)) {
                throw new Error(`项目文档 baseRevision 非法: actual=${String(info.baseRevision)}`);
            }
            const md = typeof info.markdown === 'string' ? info.markdown : '';
            const now = this.runtimeNow();
            const nextRevision = currentRevision + 1;
            const persistenceMode = info.persistenceMode ?? 'structure';
            {
                ctx.write('markdown', md);
                ctx.write('revision', nextRevision);
                ctx.write('lastUpdatedAt', now);
                ctx.send({
                    type: 'DocumentUpdatedInfo',
                    markdown: md,
                    revision: nextRevision,
                    persistenceMode,
                }, 'node-md-parser');
            }
            return;
        }
        if (info.type === 'ProjectMarkdownRunRequestedInfo') {
            const md = typeof info.markdown === 'string' ? info.markdown : '';
            const now = this.runtimeNow();
            const nextRevision = currentRevision + 1;
            {
                ctx.write('markdown', md);
                ctx.write('revision', nextRevision);
                ctx.write('lastUpdatedAt', now);
                ctx.send({
                    type: 'DocumentUpdatedInfo',
                    markdown: md,
                    revision: nextRevision,
                    persistenceMode: 'full',
                }, 'node-md-parser');
            }
        }
    }
    public getBodySummaryText(): string {
        return this.state.markdown
            ? `文档源: ${this.state.markdown.length} 字符`
            : this.description || '等待初始 Markdown 文本';
    }
}
export { MarkdownSourceNode as ProjectDocumentNode };
