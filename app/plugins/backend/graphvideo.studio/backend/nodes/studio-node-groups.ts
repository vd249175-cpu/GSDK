import type { EffectAdapter } from '@graphvideo/sdk/node';
import type { ElectronWindowObservation, ElectronWindowRequest } from '../effects/electron-window-adapter';
import type { SqlitePersistObservation, SqlitePersistRequest } from '../effects/sqlite-metadata-adapter';
import type { ProjectStructurePersistObservation, ProjectStructurePersistRequest } from '../effects/project-structure-adapter';
import type {
  GenerationAdapterOperationObservation,
  GenerationAdapterOperationRequest,
} from '../effects/generation-adapter-operation';
import { ElectronHostNode, ElectronWindowExecutionNode, ElectronWindowObservationNode } from './electron-host';
import { StudioApplicationLifecycleNode } from './application-lifecycle';
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
import type { GraphFactoryContext, NodeFactoryContext } from './factory';

export interface StudioNodeDependencies {
  readonly sqlitePersistAdapter?: EffectAdapter<SqlitePersistRequest, SqlitePersistObservation>;
  readonly projectStructurePersistAdapter?: EffectAdapter<ProjectStructurePersistRequest, ProjectStructurePersistObservation>;
  readonly generationAdapterOperation?: EffectAdapter<
    GenerationAdapterOperationRequest,
    GenerationAdapterOperationObservation
  >;
  readonly electronWindowAdapter?: EffectAdapter<ElectronWindowRequest, ElectronWindowObservation>;
}

type StudioNodeCtx = NodeFactoryContext<StudioNodeDependencies>;
type StudioGraphCtx = GraphFactoryContext<StudioNodeDependencies>;

function namespaced(ctx: StudioNodeCtx, localId: string): string {
  const graph = ctx as Partial<StudioGraphCtx>;
  if (typeof graph.nodeIdFor === 'function') return graph.nodeIdFor(localId);
  return localId;
}

function childCtx(ctx: StudioGraphCtx, localId: string): StudioNodeCtx {
  return {
    instanceId: ctx.instanceId,
    nodeId: ctx.nodeIdFor(localId),
    params: ctx.params,
    bindings: ctx.bindings,
    dependencies: ctx.dependencies,
    pluginId: ctx.pluginId,
    nodeIdFor: ctx.nodeIdFor,
  } as StudioNodeCtx;
}

function param<T>(ctx: StudioNodeCtx, name: string, fallback: T): T {
  const value = (ctx.params as Record<string, unknown>)[name];
  return (value === undefined ? fallback : value) as T;
}

const AUTHORING_LOCALS = ['src-fs-source', 'node-md-source', 'node-md-parser', 'node-outliner', 'n-hist'] as const;
const PERSISTENCE_LOCALS = ['node-sqlite', 'sink-sqlite-writer', 'src-sqlite-observer'] as const;
const GENERATION_LOCALS = [
  'node-sec-gate',
  'node-generation-model-resolver',
  'node-generation-task',
  'sink-generation-submit',
  'src-generation-poll',
  'src-generation-poll-scheduler',
  'sink-generation-download',
] as const;
const PLATFORM_LOCALS = [
  'node-application-lifecycle',
  'host-el',
  'sink-electron-window',
  'src-electron-window',
] as const;

function targetsFor(ctx: StudioNodeCtx): Record<string, string> {
  const t = (local: string) => namespaced(ctx, local);
  return {
    host: t('host-el'),
    lifecycle: t('node-application-lifecycle'),
    generationTask: t('node-generation-task'),
    persistenceSource: t('node-md-source'),
    document: t('node-md-source'),
    parser: t('node-md-parser'),
    outliner: t('node-outliner'),
    registry: t('node-sqlite'),
    writer: t('sink-sqlite-writer'),
    observer: t('src-sqlite-observer'),
    history: t('n-hist'),
    securityGate: t('node-sec-gate'),
    task: t('node-generation-task'),
    submit: t('sink-generation-submit'),
    poll: t('src-generation-poll'),
    pollScheduler: t('src-generation-poll-scheduler'),
    download: t('sink-generation-download'),
    resolver: t('node-generation-model-resolver'),
    windowExec: t('sink-electron-window'),
    windowObs: t('src-electron-window'),
  };
}

function nodeId(ctx: StudioNodeCtx, fallback: string): string {
  return ctx.nodeId || fallback;
}

export const createFileSystemSourceNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new FileSystemSourceNode(nodeId(ctx, 'src-fs-source'), '文件系统输入源', {
      registry: t.registry,
      document: t.document,
      writer: t.writer,
      host: t.host,
    });
  },
);
createFileSystemSourceNode.describe = () => ({
  kind: 'node',
  localIds: ['src-fs-source'],
  requiredBindings: [],
  rendererRoots: [{ localId: 'src-fs-source', infoType: 'ProjectOpenedInfo' }],
});

export const createMarkdownSourceNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new MarkdownSourceNode(
      nodeId(ctx, 'node-md-source'),
      'Markdown 文本源',
      param(ctx, 'initialMd', ''),
      { lifecycle: t.lifecycle, registry: t.registry, outliner: t.outliner, parser: t.parser },
    );
  },
);
createMarkdownSourceNode.describe = () => ({
  kind: 'node',
  localIds: ['node-md-source'],
  requiredBindings: [],
  rendererRoots: [
    { localId: 'node-md-source', infoType: 'UserMarkdownEditedInfo' },
    { localId: 'node-md-source', infoType: 'ProjectTreeEditRequestedInfo' },
  ],
});

export const createMarkdownParserNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new MarkdownParserNode(nodeId(ctx, 'node-md-parser'), '文档语法解析器', {
      outliner: t.outliner,
      registry: t.registry,
    });
  },
);
createMarkdownParserNode.describe = () => ({
  kind: 'node',
  localIds: ['node-md-parser'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createOutlinerTreeNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new OutlinerTreeNode(nodeId(ctx, 'node-outliner'), '大纲层级管理器', {
      document: t.document,
      securityGate: t.securityGate,
      history: t.history,
    });
  },
);
createOutlinerTreeNode.describe = () => ({
  kind: 'node',
  localIds: ['node-outliner'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createHistoryManagerNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new HistoryManagerNode(nodeId(ctx, 'n-hist'), '历史快照与撤回中枢', {
      registry: t.registry,
    });
  },
);
createHistoryManagerNode.describe = () => ({
  kind: 'node',
  localIds: ['n-hist'],
  requiredBindings: [],
  rendererRoots: [{ localId: 'n-hist', infoType: 'UserSnapshotActionInfo' }],
});

export const createSqliteRegistryNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new SqliteRegistryNode(nodeId(ctx, 'node-sqlite'), 'SQLite 元数据注册表', {
      writer: t.writer,
      history: t.history,
      lifecycle: t.lifecycle,
      task: t.task,
    });
  },
);
createSqliteRegistryNode.describe = () => ({
  kind: 'node',
  localIds: ['node-sqlite'],
  requiredBindings: [],
  rendererRoots: [{ localId: 'node-sqlite', infoType: 'UserMetadataPatchInfo' }],
});

export const createSqliteWriterSinkNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new SqliteWriterSinkNode(
      nodeId(ctx, 'sink-sqlite-writer'),
      'SQLite磁盘写入端',
      ctx.dependencies.sqlitePersistAdapter,
      ctx.dependencies.projectStructurePersistAdapter,
      t.observer,
    );
  },
);
createSqliteWriterSinkNode.describe = () => ({
  kind: 'node',
  localIds: ['sink-sqlite-writer'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createSqliteObserverSourceNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new SqliteObserverSourceNode(nodeId(ctx, 'src-sqlite-observer'), 'SQLite落盘观测源', {
      registry: t.registry,
    });
  },
);
createSqliteObserverSourceNode.describe = () => ({
  kind: 'node',
  localIds: ['src-sqlite-observer'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createSecurityGateNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => new SecurityGateNode(
    nodeId(ctx, 'node-sec-gate'),
    '风控与预算关口',
    { maxCreditBudget: param(ctx, 'maxCreditBudget', undefined) as number | undefined },
    (() => {
      const t = targetsFor(ctx);
      return { task: t.task, submit: t.submit, registry: t.registry };
    })(),
  ),
);
createSecurityGateNode.describe = () => ({
  kind: 'node',
  localIds: ['node-sec-gate'],
  requiredBindings: [],
  rendererRoots: [
    { localId: 'node-sec-gate', infoType: 'GenerationBudgetConfiguredInfo' },
    { localId: 'node-sec-gate', infoType: 'GenerationCreditsResetInfo' },
  ],
});

export const createGenerationTaskNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new GenerationTaskNode(
      nodeId(ctx, 'node-generation-task'),
      '生成任务状态控制器',
      t.securityGate,
      t.poll,
      t.download,
      t.pollScheduler,
      t.securityGate,
      { lifecycle: t.lifecycle },
    );
  },
);
createGenerationTaskNode.describe = () => ({
  kind: 'node',
  localIds: ['node-generation-task'],
  requiredBindings: [],
  rendererRoots: [{ localId: 'node-generation-task', infoType: 'GenerationBatchCancelRequestedInfo' }],
});

export const createGenerationModelResolverNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new GenerationModelResolverNode(
      nodeId(ctx, 'node-generation-model-resolver'),
      '生成模型解析器',
      t.task,
      t.task,
    );
  },
);
createGenerationModelResolverNode.describe = () => ({
  kind: 'node',
  localIds: ['node-generation-model-resolver'],
  requiredBindings: [],
  rendererRoots: [{ localId: 'node-generation-model-resolver', infoType: 'GenerationBatchRequestedInfo' }],
});

export const createGenerationSubmitNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new GenerationSubmitSinkNode(
      nodeId(ctx, 'sink-generation-submit'),
      '生成请求提交端',
      ctx.dependencies.generationAdapterOperation,
      t.task,
    );
  },
);
createGenerationSubmitNode.describe = () => ({
  kind: 'node',
  localIds: ['sink-generation-submit'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createGenerationPollNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new GenerationPollSourceNode(
      nodeId(ctx, 'src-generation-poll'),
      '生成状态单次观测端',
      ctx.dependencies.generationAdapterOperation,
      t.task,
    );
  },
);
createGenerationPollNode.describe = () => ({
  kind: 'node',
  localIds: ['src-generation-poll'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createGenerationPollSchedulerNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new GenerationPollSchedulerNode(
      nodeId(ctx, 'src-generation-poll-scheduler'),
      '生成轮询调度源',
      undefined,
      t.task,
    );
  },
);
createGenerationPollSchedulerNode.describe = () => ({
  kind: 'node',
  localIds: ['src-generation-poll-scheduler'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createGenerationDownloadNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new GenerationDownloadSinkNode(
      nodeId(ctx, 'sink-generation-download'),
      '生成产物下载端',
      ctx.dependencies.generationAdapterOperation,
      t.task,
    );
  },
);
createGenerationDownloadNode.describe = () => ({
  kind: 'node',
  localIds: ['sink-generation-download'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createElectronHostNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new ElectronHostNode(nodeId(ctx, 'host-el'), '桌面生命周期控制器', {
      lifecycle: t.lifecycle,
      windowExec: t.windowExec,
    });
  },
);
createElectronHostNode.describe = () => ({
  kind: 'node',
  localIds: ['host-el'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createElectronWindowExecutionNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new ElectronWindowExecutionNode(
      nodeId(ctx, 'sink-electron-window'),
      '桌面窗口执行端',
      ctx.dependencies.electronWindowAdapter,
      { windowObs: t.windowObs, host: t.host },
    );
  },
);
createElectronWindowExecutionNode.describe = () => ({
  kind: 'node',
  localIds: ['sink-electron-window'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createElectronWindowObservationNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new ElectronWindowObservationNode(nodeId(ctx, 'src-electron-window'), '桌面窗口观测端', {
      host: t.host,
    });
  },
);
createElectronWindowObservationNode.describe = () => ({
  kind: 'node',
  localIds: ['src-electron-window'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createLifecycleNode = defineNodeFactory(
  (ctx: StudioNodeCtx) => {
    const t = targetsFor(ctx);
    return new StudioApplicationLifecycleNode(nodeId(ctx, 'node-application-lifecycle'), 'Studio 应用生命周期', {
      host: t.host,
      generationTask: t.generationTask,
      persistenceSource: t.persistenceSource,
    });
  },
);
createLifecycleNode.describe = () => ({
  kind: 'node',
  localIds: ['node-application-lifecycle'],
  requiredBindings: [],
  rendererRoots: [],
});

export const createAuthoringNodes = defineGraphFactory(
  (ctx: StudioGraphCtx) => [
    createFileSystemSourceNode(childCtx(ctx, 'src-fs-source')),
    createMarkdownSourceNode(childCtx(ctx, 'node-md-source')),
    createMarkdownParserNode(childCtx(ctx, 'node-md-parser')),
    createOutlinerTreeNode(childCtx(ctx, 'node-outliner')),
    createHistoryManagerNode(childCtx(ctx, 'n-hist')),
  ],
);
createAuthoringNodes.describe = () => ({
  kind: 'graph',
  localIds: [...AUTHORING_LOCALS],
  requiredBindings: [],
  rendererRoots: [
    { localId: 'src-fs-source', infoType: 'ProjectOpenedInfo' },
    { localId: 'node-md-source', infoType: 'UserMarkdownEditedInfo' },
    { localId: 'node-md-source', infoType: 'ProjectTreeEditRequestedInfo' },
    { localId: 'n-hist', infoType: 'UserSnapshotActionInfo' },
  ],
});

export const createPersistenceNodes = defineGraphFactory(
  (ctx: StudioGraphCtx) => [
    createSqliteRegistryNode(childCtx(ctx, 'node-sqlite')),
    createSqliteWriterSinkNode(childCtx(ctx, 'sink-sqlite-writer')),
    createSqliteObserverSourceNode(childCtx(ctx, 'src-sqlite-observer')),
  ],
);
createPersistenceNodes.describe = () => ({
  kind: 'graph',
  localIds: [...PERSISTENCE_LOCALS],
  requiredBindings: [],
  rendererRoots: [{ localId: 'node-sqlite', infoType: 'UserMetadataPatchInfo' }],
});

export const createGenerationNodes = defineGraphFactory(
  (ctx: StudioGraphCtx) => [
    createSecurityGateNode(childCtx(ctx, 'node-sec-gate')),
    createGenerationModelResolverNode(childCtx(ctx, 'node-generation-model-resolver')),
    createGenerationTaskNode(childCtx(ctx, 'node-generation-task')),
    createGenerationSubmitNode(childCtx(ctx, 'sink-generation-submit')),
    createGenerationPollNode(childCtx(ctx, 'src-generation-poll')),
    createGenerationPollSchedulerNode(childCtx(ctx, 'src-generation-poll-scheduler')),
    createGenerationDownloadNode(childCtx(ctx, 'sink-generation-download')),
  ],
);
createGenerationNodes.describe = () => ({
  kind: 'graph',
  localIds: [...GENERATION_LOCALS],
  requiredBindings: [],
  rendererRoots: [
    { localId: 'node-sec-gate', infoType: 'GenerationBudgetConfiguredInfo' },
    { localId: 'node-sec-gate', infoType: 'GenerationCreditsResetInfo' },
    { localId: 'node-generation-model-resolver', infoType: 'GenerationBatchRequestedInfo' },
    { localId: 'node-generation-task', infoType: 'GenerationBatchCancelRequestedInfo' },
  ],
});

export const createPlatformNodes = defineGraphFactory(
  (ctx: StudioGraphCtx) => [
    createLifecycleNode(childCtx(ctx, 'node-application-lifecycle')),
    createElectronHostNode(childCtx(ctx, 'host-el')),
    createElectronWindowExecutionNode(childCtx(ctx, 'sink-electron-window')),
    createElectronWindowObservationNode(childCtx(ctx, 'src-electron-window')),
  ],
);
createPlatformNodes.describe = () => ({
  kind: 'graph',
  localIds: [...PLATFORM_LOCALS],
  requiredBindings: [],
  rendererRoots: [],
});
