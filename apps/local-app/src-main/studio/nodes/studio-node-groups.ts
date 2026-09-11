import type { EffectAdapter } from '@graphvideo/kernel';
import type { ElectronWindowObservation, ElectronWindowRequest } from '../effects/electron-window-adapter';
import type { SqlitePersistObservation, SqlitePersistRequest } from '../effects/sqlite-metadata-adapter';
import type { ProjectStructurePersistObservation, ProjectStructurePersistRequest } from '../effects/project-structure-adapter';
import type {
  GenerationAdapterOperationObservation,
  GenerationAdapterOperationRequest,
} from '../effects/generation-adapter-operation';
import { ElectronHostNode } from './electron-host';
import { FileSystemSourceNode } from './file-system';
import { SecurityGateNode } from './generation-security';
import { GenerationDownloadSinkNode } from './generation-download';
import { GenerationPollSourceNode } from './generation-poll';
import { GenerationPollSchedulerNode } from './generation-poll-scheduler';
import { GenerationSubmitSinkNode } from './generation-submit';
import { GenerationTaskNode } from './generation-task';
import { GenerationModelResolverNode } from './generation-model-resolver';
import { HistoryManagerNode } from './history-manager';
import { MarkdownParserNode } from './markdown-parser';
import { MarkdownSourceNode } from './markdown-source';
import { OutlinerTreeNode } from './outliner-tree';
import { SqliteObserverSourceNode } from './sqlite-observer';
import { SqliteRegistryNode } from './sqlite-registry';
import { SqliteWriterSinkNode } from './sqlite-writer';
import { defineGraphFactory, defineNodeFactory } from './factory';

export interface StudioNodeDependencies {
  readonly sqlitePersistAdapter?: EffectAdapter<SqlitePersistRequest, SqlitePersistObservation>;
  readonly projectStructurePersistAdapter?: EffectAdapter<ProjectStructurePersistRequest, ProjectStructurePersistObservation>;
  readonly generationAdapterOperation?: EffectAdapter<
    GenerationAdapterOperationRequest,
    GenerationAdapterOperationObservation
  >;
  readonly electronWindowAdapter?: EffectAdapter<ElectronWindowRequest, ElectronWindowObservation>;
}

export const createFileSystemSourceNode = defineNodeFactory(
  (_dependencies: StudioNodeDependencies) => new FileSystemSourceNode('src-fs-source', '文件系统输入源'),
);
export const createMarkdownSourceNode = defineNodeFactory(
  (_dependencies: StudioNodeDependencies) => new MarkdownSourceNode('node-md-source', 'Markdown 文本源'),
);
export const createMarkdownParserNode = defineNodeFactory(
  (_dependencies: StudioNodeDependencies) => new MarkdownParserNode('node-md-parser', '文档语法解析器'),
);
export const createOutlinerTreeNode = defineNodeFactory(
  (_dependencies: StudioNodeDependencies) => new OutlinerTreeNode('node-outliner', '大纲层级管理器'),
);
export const createHistoryManagerNode = defineNodeFactory(
  (_dependencies: StudioNodeDependencies) => new HistoryManagerNode('n-hist', '历史快照与撤回中枢'),
);

export const createSqliteRegistryNode = defineNodeFactory(
  (_dependencies: StudioNodeDependencies) => new SqliteRegistryNode('node-sqlite', 'SQLite 元数据注册表'),
);
export const createSqliteWriterSinkNode = defineNodeFactory(
  (dependencies: StudioNodeDependencies) => new SqliteWriterSinkNode(
    'sink-sqlite-writer', 'SQLite磁盘写入端',
    dependencies.sqlitePersistAdapter, dependencies.projectStructurePersistAdapter,
  ),
);
export const createSqliteObserverSourceNode = defineNodeFactory(
  (_dependencies: StudioNodeDependencies) => new SqliteObserverSourceNode('src-sqlite-observer', 'SQLite落盘观测源'),
);

export const createSecurityGateNode = defineNodeFactory(
  (_dependencies: StudioNodeDependencies) => new SecurityGateNode('node-sec-gate', '风控与预算关口'),
);
export const createGenerationTaskNode = defineNodeFactory(
  (_dependencies: StudioNodeDependencies) => new GenerationTaskNode(
    'node-generation-task', '生成任务状态控制器',
  ),
);
export const createGenerationModelResolverNode = defineNodeFactory(
  (_dependencies: StudioNodeDependencies) => new GenerationModelResolverNode(
    'node-generation-model-resolver', '生成模型解析器',
  ),
);
export const createGenerationSubmitNode = defineNodeFactory(
  (dependencies: StudioNodeDependencies) => new GenerationSubmitSinkNode(
    'sink-generation-submit', '生成请求提交端', dependencies.generationAdapterOperation,
  ),
);
export const createGenerationPollNode = defineNodeFactory(
  (dependencies: StudioNodeDependencies) => new GenerationPollSourceNode(
    'src-generation-poll', '生成状态单次观测端', dependencies.generationAdapterOperation,
  ),
);
export const createGenerationPollSchedulerNode = defineNodeFactory(
  (_dependencies: StudioNodeDependencies) => new GenerationPollSchedulerNode(
    'src-generation-poll-scheduler', '生成轮询调度源',
  ),
);
export const createGenerationDownloadNode = defineNodeFactory(
  (dependencies: StudioNodeDependencies) => new GenerationDownloadSinkNode(
    'sink-generation-download', '生成产物下载端', dependencies.generationAdapterOperation,
  ),
);
export const createElectronHostNode = defineNodeFactory(
  (dependencies: StudioNodeDependencies) => new ElectronHostNode(
    'host-el', '应用级桌面渲染宿主', dependencies.electronWindowAdapter,
  ),
);

export const createAuthoringNodes = defineGraphFactory(
  (dependencies: StudioNodeDependencies) => [
    createFileSystemSourceNode(dependencies),
    createMarkdownSourceNode(dependencies),
    createMarkdownParserNode(dependencies),
    createOutlinerTreeNode(dependencies),
    createHistoryManagerNode(dependencies),
  ],
);

export const createPersistenceNodes = defineGraphFactory(
  (dependencies: StudioNodeDependencies) => [
    createSqliteRegistryNode(dependencies),
    createSqliteWriterSinkNode(dependencies),
    createSqliteObserverSourceNode(dependencies),
  ],
);

export const createGenerationNodes = defineGraphFactory(
  (dependencies: StudioNodeDependencies) => [
    createSecurityGateNode(dependencies),
    createGenerationModelResolverNode(dependencies),
    createGenerationTaskNode(dependencies),
    createGenerationSubmitNode(dependencies),
    createGenerationPollNode(dependencies),
    createGenerationPollSchedulerNode(dependencies),
    createGenerationDownloadNode(dependencies),
  ],
);

export const createPlatformNodes = defineGraphFactory(
  (dependencies: StudioNodeDependencies) => [
    createElectronHostNode(dependencies),
  ],
);

