---
type: Contract
title: 插件全景与契约索引 (Plugin Reference)
description: GSDK 业务插件规范、当前插件拓扑全景清单（包含 Node、Info、State、Elements）以及内核与 SDK 边界说明。
status: stable
tags: [plugins, reference, topology, contracts]
---

# 插件全景与契约索引 (Plugin Reference)

本文件是当前业务插件的导航与关键契约索引。完整装配以各插件 Manifest、backend 工厂、Node 源码及针对性测试为准；下面记录关键输入输出，不代替全部 payload 定义。

> **核心原则**：
> 1. **业务迭代优先消费内核**：日常功能、UI 与模型接入放在插件中，避免向 Rust 加入业务语义。涉及调度、版本、执行或分析协议时，仍需对照内核源码与针对性测试核实边界。
> 2. **全栈通过 SDK 交互**：后端主进程与插件使用 `@graphvideo/sdk` 的 node/plugin/effect 等公开子路径，前端仅通过 SDK Client 提供的快照与命令进行交互。
> 3. **插件平权**：内置业务插件（如 `graphvideo.studio`）与第三方插件采用完全相同的 Manifest、装配接口与执行生命周期。

---

## 1. 架构边界与 SDK 分工

```text
┌────────────────────────────────────────────────────────┐
│                   前端 UI (Renderer)                   │
│   React 组件 / Workbench Elements / 自定义 Inspector   │
└─────────────────────────┬──────────────────────────────┘
                          │ 仅通过 @graphvideo/client 交互
                          │ (useAppState / useApplicationClient)
┌─────────────────────────▼──────────────────────────────┐
│             插件系统层 (plugins)        │
│   Manifest (graphvideo.plugin.json) + backend.ts       │
│   - 声明 rendererRoots (公开给前端的安全入口)          │
│   - 组装 Authoring / Persistence / Generation Nodes     │
└─────────────────────────┬──────────────────────────────┘
                          │ 通过 @graphvideo/sdk 定义 Node/Info
                          │ 挂载至 NativeRuleSpace
┌─────────────────────────▼──────────────────────────────┐
│             底座内核 (零业务语义，统一生产调度)            │
│   Rust 生产微内核 (packages/rust/kernel) + packages/sdk/javascript/src/node 规约       │
└────────────────────────────────────────────────────────┘
```

- **前端视角**：
  - 读事实：只通过快照 `useAppState(selector)` 读取已解码的投影 DTO；
  - 触发动作：只通过 `client.injectRootInfo(targetNodeId, info)` 向受信任的 `rendererRoots` 注入意图。
- **后端视角**：
  - 纯领域 Node：零 I/O、零网络、零 Electron API，仅通过 `change(info, ctx)` 推进内部状态或 `ctx.send(nextInfo, targetId)`；
  - 副作用 WorldNode：严格区分**执行类 (`ExecutionWorldNode`)** 与**观察类 (`ObservationWorldNode`)**，物理动作由构造注入的 `EffectAdapter` 执行。

---

## 2. 插件标准契约 (Plugin Contract)

本仓库插件位于 `app/plugins/<plugin-directory>/`；目录名不必等于 Manifest ID，外部目录由 application.json 的 path 指定：

### 2.1 Manifest 规范 (`graphvideo.plugin.json`)
```json
{
  "id": "graphvideo.studio",
  "name": "GraphVideo Studio",
  "version": "1.0.0",
  "apiVersion": 1,
  "contributes": {
    "backend": "backend.ts",
    "elements": ["agent-console", "generation", "markdown-editor", "outliner", "prompt-library", "properties"],
    "workspaces": ["editing", "generation", "review", "agent"]
  }
}
```

### 2.2 后端入口规范 (`backend.ts`)
后端通过 `defineBackendPlugin` 导出，提供节点实例与前端白名单：
```ts
import { defineBackendPlugin } from '@graphvideo/sdk/plugin'

export default defineBackendPlugin({
  id: 'my-plugin',
  // 暴露给前端的安全入口白名单 (必须能静态证明类型)
  rendererRoots: [
    { targetNodeId: 'node-target', infoType: 'ActionRequestedInfo', validate: (info) => Boolean(info) },
  ],
  // 规则空间装载时调用的节点工厂
  createNodes: ({ dependencies }) => [
    new MyDomainNode(),
  ],
})
```

---

## 3. 核心插件清单：`graphvideo.studio`

`graphvideo.studio` 是当前本地桌面端的核心创作套件，管理项目大纲、元数据、提示词以及云端 ComfyUI 生成流水线。

### 3.1 后端 Node 全景与职责

#### (1) 创作与解析组 (Authoring & Parsing)
| Node ID | 类别 | 职责说明 | 关键输入 Info | 关键输出 / 发送 Info |
| :--- | :--- | :--- | :--- | :--- |
| `src-fs-source` | WorldNode（观察职责） | 接收宿主已读取的项目 DTO，持有当前输入来源 | ProjectOpenedInfo | ProjectMetadataHydratedInfo → node-sqlite；ProjectMarkdownRunRequestedInfo → node-md-source |
| `node-md-source` | 纯领域 Node | 持有 Markdown 源文本并处理文本/树编辑 | UserMarkdownEditedInfo；ProjectTreeEditRequestedInfo；ProjectMarkdownRunRequestedInfo | DocumentUpdatedInfo → node-md-parser；ProjectTreeEditTaskInfo → node-outliner |
| `node-md-parser` | 纯领域 Node | 将当前 Markdown 纯解析为结构与问题 | DocumentUpdatedInfo | ParsedAstTreeInfo → node-outliner；SyncTreeInfo → node-sqlite |
| `node-outliner` | 纯领域 Node | 持有大纲树并计算树编辑的文档替换 | ParsedAstTreeInfo；ProjectTreeEditTaskInfo | ProjectDocumentReplacementInfo → node-md-source；StructureMarkdownInfo → node-sec-gate；StateToCaptureInfo → n-hist |
| `n-hist` | 纯领域 Node | 持有元数据历史与撤回重做位置 | TaskFactObservedInfo；UserSnapshotActionInfo；ProjectHistoryResetInfo | RevertMetadataTaskInfo → node-sqlite |

#### (2) 持久化与同步组 (Persistence & Database)
| Node ID | 类别 | 职责说明 | 关键输入 Info | 关键输出 / 发送 Info |
| :--- | :--- | :--- | :--- | :--- |
| `node-sqlite` | 纯领域 Node | 唯一持有节点元数据、媒体版本与持久化结果 | UserMetadataPatchInfo；SyncTreeInfo；ArtifactSavedObservedInfo | PersistMetadataTaskInfo / PersistProjectStructureTaskInfo → sink-sqlite-writer；历史事实 → n-hist |
| `sink-sqlite-writer` | WorldNode（执行职责） | 经注入 Adapter 写元数据或项目结构 | PersistMetadataTaskInfo；PersistProjectStructureTaskInfo | PhysicalDiskMutationInfo / PhysicalProjectStructureMutationInfo → src-sqlite-observer；失败观察 → src-sqlite-observer |
| `src-sqlite-observer` | WorldNode（观察职责） | 将物理写入结果转换为持久化观察，不承担项目文件监听器 | PhysicalDiskMutationInfo；PhysicalProjectStructureMutationInfo；DatabaseWriteFailedObservedInfo | DatabaseSavedObservedInfo / ProjectStructurePersistedObservedInfo / DatabaseWriteFailedObservedInfo → node-sqlite |

#### (3) 生成调度与云端流水线组 (Generation Pipeline)
| Node ID | 类别 | 职责说明 | 关键输入 Info | 关键输出 / 发送 Info |
| :--- | :--- | :--- | :--- | :--- |
| `node-sec-gate` | 纯领域 Node | 持有生成预算和积分，对计划及提交进行准入 | GenerationBudgetConfiguredInfo；GenerationCreditsResetInfo；GenerationBatchPlannedInfo；GenerationSubmitBatchRequestedInfo | 计划 → node-generation-task；允许的提交 → sink-generation-submit；产物观察 → node-sqlite |
| `node-generation-model-resolver` | 纯领域 Node | 基于项目/目录 DTO 解析模型输入与批次计划 | GenerationBatchRequestedInfo；GenerationModelResolutionRequestedInfo | GenerationBatchPlannedInfo / GenerationModelResolutionCompletedInfo / GenerationModelResolutionFailedInfo → node-generation-task |
| `node-generation-task` | 纯领域 Node | 持有批次/任务状态，编排提交、轮询、下载和取消 | GenerationBatchPlannedInfo；GenerationBatchCancelRequestedInfo；各阶段批次 Observation | GenerationSubmitBatchRequestedInfo → node-sec-gate；GenerationPollBatchRequestedInfo → src-generation-poll；GenerationDownloadBatchRequestedInfo → sink-generation-download；GenerationPollScheduleRequestedInfo → src-generation-poll-scheduler |
| `sink-generation-submit` | WorldNode（执行职责） | 经 generationAdapterOperation 提交批次并取得外部 handle | GenerationSubmitBatchRequestedInfo | GenerationBatchSubmittedObservedInfo → node-generation-task |
| `src-generation-poll-scheduler` | WorldNode（等待/观察职责） | 经 delay Adapter 等待下一次轮询时刻 | GenerationPollScheduleRequestedInfo | GenerationTasksPollRequestedInfo → node-generation-task |
| `src-generation-poll` | WorldNode（观察职责） | 经 Adapter 读取外部批次状态 | GenerationPollBatchRequestedInfo | GenerationBatchPolledObservedInfo → node-generation-task |
| `sink-generation-download` | WorldNode（执行职责） | 经 Adapter 下载产物并落入项目目标目录 | GenerationDownloadBatchRequestedInfo | GenerationBatchDownloadedObservedInfo → node-generation-task |

---

### 3.2 平台与桌面生命周期

上述分类记录当前行为职责。部分物理类仍直接继承 WorldNode，而非 ExecutionWorldNode/ObservationWorldNode 专门基类；不能据此声称专门基类的全部迁移已经完成。项目外部文件监听属于 Studio desktop/services/project-external-sync.mjs，由宿主回送事实，不由 src-sqlite-observer 持有监听器。

平台与桌面生命周期组同属 Studio 普通插件工厂：

| Node ID | 类别 | 输入与因果推进 |
| --- | --- | --- |
| host-el | 纯领域 Node | DesktopStartRequestedInfo / DesktopCloseRequestedInfo → sink-electron-window；DesktopWindowObservedInfo 更新窗口 State |
| sink-electron-window | ExecutionWorldNode | ElectronWindowEffectRequestedInfo → 注入的窗口 Adapter；结果或失败定向发送 |
| src-electron-window | ObservationWorldNode | 接收执行观察及系统 closed 事件，DesktopWindowObservedInfo → host-el |

窗口关闭后图宿主继续运行；当前没有将 Studio 装配迁入独立 daemon。

### 3.3 前端 Elements 与工作区映射

`graphvideo.studio` 前端界面划分为以下 6 个核心 Element，可在不同的工作区（Workspace）自由编排：

| Element ID | 展示形态 | 核心功能 | 绑定的后端 Node 投影 |
| :--- | :--- | :--- | :--- |
| `outliner` | 左侧大纲树面板 | 树状呈现场景、镜头、分镜与文案节点，支持键盘上下切换与拖拽排序 | `node-outliner` / `node-md-source` |
| `properties` | 右侧属性检查器 | 显示当前选中节点的详细参数（提示词、时长、分辨率、参考图、音频关联） | `node-sqlite` |
| `generation` | 底部/右侧生成控制台 | Launchpad 快速生成入口、批量生成列表、当前排队中/渲染中任务进度条、点数消耗预估 | `node-generation-task` / `node-sec-gate` |
| `prompt-library` | 抽屉/独立视口 | 预置与自定义 Prompt 资产管理（画面运镜、艺术风格、影视构图） | 本地资源文件 `resources/prompt-library` |
| `agent-console` | 悬浮或右侧抽屉 | 智能编剧、分镜师、提示词工程师多 Agent 交互控制台，支持上下文感知生成 | `services/agent-catalog.mjs` |
| `markdown-editor` | 源码编辑面板 | 双向同步的 Markdown 原始文档编辑视图 | `node-md-source` |

---

## 4. 参考插件：`hello-counter`

`hello-counter` 是最小规范插件，适合用作开发新插件时的脚手架骨架：
- **ID**: `example.hello-counter`
- **Node**: `example.counter` (持有 `{ count: number }`)
- **Action**: `IncrementInfo`
- **特点**: 单个纯领域 Node，无外部副作用，具备确定性 Vitest 测试。

---

## 5. 前端交互速查表（如何发送动作与读取状态）

Studio 自己的 `frontend/client/sdk/index.ts` 转出绑定后的 useAppState/useApplicationClient；这些业务绑定不是通用 frontend 包中的 GraphVideo 专属 API。下表列出当前 GraphVideoApplicationClient 的实际命令和对应图入口；payload 以 `frontend/application/contract/` 与后端 rendererRoots 为准：

| 用户操作 | 前端调用的 SDK 命令 / Info | 目标 Node ID | 说明 |
| :--- | :--- | :--- | :--- |
| **打开项目** | client.project.open(path) | src-fs-source / ProjectOpenedInfo | 先由宿主读取项目 DTO，再注入已存在的规则空间 |
| **编辑大纲/文本** | client.project.runMarkdown(markdown)；client.project.editTree(input) | node-md-source / UserMarkdownEditedInfo、ProjectTreeEditRequestedInfo | 文本与树编辑按实际合同推进解析与持久化 |
| **修改节点属性** | client.project.patchNode(input) | node-sqlite / UserMetadataPatchInfo | patchNode 的 input 形状以应用 contract 为准 |
| **启动生成** | client.generationModels.generate(nodeId, options)；generateBatch(items, options) | node-generation-model-resolver / GenerationBatchRequestedInfo | 由应用服务准备 project/catalog/批次数据后提交 |
| **取消任务** | client.injectRootInfo('node-generation-task', { type: 'GenerationBatchCancelRequestedInfo', batchId }) | node-generation-task | 请求取消该批次；取消已发生的物理效果不回滚 |
| **撤回/重做** | client.history.undo() / redo() | n-hist / UserSnapshotActionInfo | 通过历史业务 Info 请求元数据变迁 |
| **设置预算** | client.generation.configureBudget(maxBudget) | node-sec-gate / GenerationBudgetConfiguredInfo | 配置预算；resetCredits 使用独立固定命令 |
