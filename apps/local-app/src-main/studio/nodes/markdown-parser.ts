import { Node } from '@graphvideo/kernel';
import type { Info, DomainChangeContext } from '@graphvideo/kernel';
import { parseProjectMarkdown } from '../domain/markdown/markdown-parser';
import type { ParsedProject, ProjectIssue, ProjectTreeItem, } from '../domain/types';
import type { DocumentUpdatedInfo } from '../protocol';
export interface MarkdownParserState {
    tree: ProjectTreeItem[];
    issues: ProjectIssue[];
    lastParsedAt: number;
}
export class MarkdownParserNode extends Node<MarkdownParserState> {
    public get latestTree(): ProjectTreeItem[] {
        return this.state.tree;
    }
    public get latestIssues(): ProjectIssue[] {
        return this.state.issues;
    }
    constructor(id: string = 'node-md-parser', name: string = '文档语法解析器') {
        super(id, name, {
            tree: [],
            issues: [],
            lastParsedAt: 0,
        });
        this.icon = '🌲';
        this.description =
            '【AST 语法树解析】增量解析 Markdown 结构与标题分块\n【异常诊断】捕获 Prompt 标记与格式语法 Issue\n【双向派发】向下游大纲树与 SQLite 同步 ParsedAstTreeInfo';
    }
    protected override async change(info: Info, ctx: DomainChangeContext<MarkdownParserState>): Promise<void> {
        if (info.type !== 'DocumentUpdatedInfo')
            return;
        const md = (info as DocumentUpdatedInfo).markdown;
        if (md !== undefined && md !== null) {
            const now = this.runtimeNow();
            let result: ParsedProject = { tree: [], declarations: [], issues: [] };
            {
                result = await ctx.span('parse_ast_tree', () => parseProjectMarkdown(md));
                ctx.write('tree', result.tree);
                ctx.write('issues', result.issues);
                ctx.write('lastParsedAt', now);
                ctx.send({
                    type: 'ParsedAstTreeInfo',
                    tree: result.tree,
                    issues: result.issues,
                    markdown: md,
                }, 'node-outliner');
                ctx.send({
                    type: 'SyncTreeInfo',
                    tree: result.tree,
                    nodes: result.declarations,
                    markdown: md,
                    persistenceMode: info.persistenceMode ?? 'full',
                }, 'node-sqlite');
            }
        }
    }
    public getBodySummaryText(): string {
        return this.state.issues.length > 0
            ? `发现 ${this.state.issues.length} 处语法异常`
            : this.state.tree.length > 0
                ? `结构解析就绪 (${this.state.tree.length}章节)`
                : '等待文档输入';
    }
}
