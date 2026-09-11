import { WorldNode } from '@graphvideo/kernel';
import type { Info, WorldChangeContext } from '@graphvideo/kernel';
import type { ProjectNode } from '../domain/types';
export interface FileSystemState {
    projectName: string;
    currentPath: string;
    loadedBytes: number;
    lastObservedAt: number;
}
export class FileSystemSourceNode extends WorldNode<FileSystemState> {
    constructor(id: string = 'src-fs-source', name: string = '文件系统输入源') {
        super(id, name, {
            projectName: '未打开项目',
            currentPath: '.graphvideo/nodes.sqlite',
            loadedBytes: 0,
            lastObservedAt: 0,
        });
        this.icon = '📄';
        this.description =
            '【现实观测源】观测外部文件系统变动与导入网关 (Import Gateway)\n【协议提升】文件变动 -> ProjectConfigObservedInfo\n【单向流】将外部导入与环境事实推流至下游中台';
    }
    protected override async change(info: Info, ctx: WorldChangeContext<FileSystemState>): Promise<void> {
        const now = this.runtimeNow();
        if (info.type === 'ProjectOpenedInfo' && info.project) {
            const project = info.project as {
                name: string;
                path: string;
                markdown: string;
                nodes: ProjectNode[];
                retainedNodes: ProjectNode[];
            };
            ctx.patchState({
                projectName: project.name,
                currentPath: project.path,
                loadedBytes: project.markdown.length,
                lastObservedAt: now,
            });
            ctx.send({
                type: 'ProjectMetadataHydratedInfo',
                nodes: project.nodes,
                retainedNodes: project.retainedNodes,
                observedAt: now,
            }, 'node-sqlite');
            ctx.send({
                type: 'ProjectMarkdownRunRequestedInfo',
                markdown: project.markdown,
                hydration: true,
            }, 'node-md-source');
            const configTargets = ['sink-sqlite-writer'];
            for (const target of configTargets) {
                ctx.send({
                    type: 'ProjectConfigObservedInfo',
                    projectName: project.name,
                    projectPath: project.path,
                    config: {
                        projectRoot: project.path,
                        projectId: project.path,
                        exportDirectory: project.path,
                    },
                }, target);
            }
            return;
        }
        if (info.type === 'BootInfo') {
            {
                ctx.write('lastObservedAt', now);
            }
        }
        else if (info.type === 'WatchPathInfo' && info.path) {
            {
                ctx.write('currentPath', String(info.path));
            }
        }
        else if (info.type === 'ShutdownInfo') {
            {
                ctx.write('loadedBytes', 0);
                ctx.send({
                    type: 'StoppedInfo',
                    nodeId: this.id,
                }, 'host-el');
            }
        }
    }
    public getBodySummaryText(): string {
        return this.state.loadedBytes > 0
            ? `【当前项目】${this.state.projectName}\n【当前装载】${this.state.currentPath} (${this.state.loadedBytes} B)\n【协议输出】ProjectFileObservedInfo`
            : this.description;
    }
}
export { FileSystemSourceNode as FileSystemWorldNode };
