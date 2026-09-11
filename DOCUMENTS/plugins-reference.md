---
type: reference
title: 插件全景与契约索引 (Plugin Reference)
description: GSDK 业务插件规范、当前插件拓扑全景清单（包含 Node、Info、State、Elements）以及内核与 SDK 边界说明。
---

# 插件全景与契约索引 (Plugin Reference)

本文件是 GSDK 上层业务插件的**单一事实来源（Single Source of Truth）**。它完整记录了当前所有业务插件的拓扑、Node 职责、因果流转（Info）、状态所有权与前端 Element 映射。

> **核心原则**：
> 1. **内核已稳定冻结**：底层 Rust 调度微内核 (`crates/kernel`)、`NativeRuleSpace` 与微内核规约 (`core/src`) 已全面稳定。日常功能迭代、UI 改造或模型接入**禁止且无需翻看或修改内核代码**。
> 2. **全栈通过 SDK 交互**：后端主进程与插件统一使用 `@graphvideo/sdk`，前端仅通过 SDK Client 提供的快照与命令进行交互。
> 3. **插件平权**：内置业务插件（如 `graphvideo.studio`）与第三方插件采用完全相同的 Manifest、装配接口与执行生命周期。

---

## 1. 架构边界与 SDK 分工

```text
┌────────────────────────────────────────────────────────┐
│                   前端 UI (Renderer)                   │
│   React 组件 / Workbench Elements / 自定义 Inspector   │
└─────────────────────────┬──────────────────────────────┘
                          │ 仅通过 @graphvideo/sdk/client 交互
                          │ (useGraphVideoSnapshot / useGraphVideoClient)
┌─────────────────────────▼──────────────────────────────┐
│             插件系统层 (apps/local-app/plugins)        │
│   Manifest (graphvideo.plugin.json) + backend.ts       │
│   - 声明 rendererRoots (公开给前端的安全入口)          │
│   - 组装 Authoring / Persistence / Generation Nodes     │
└─────────────────────────┬──────────────────────────────┘
                          │ 通过 @graphvideo/sdk 定义 Node/Info
                          │ 挂载至 NativeRuleSpace
┌─────────────────────────▼──────────────────────────────┐
│             底座内核 (已冻结稳定，无需翻看)            │
│   Rust 生产微内核 (crates/kernel) + core/src 规约       │
└────────────────────────────────────────────────────────┘
```

- **前端视角**：
  - 读事实：只通过快照 `useGraphVideoSnapshot(nodeId, selector)` 读取已解码的投影 DTO；
  - 触发动作：只通过 `client.submitInfo(targetNodeId, info)` 向受信任的 `rendererRoots` 注入意图。
- **后端视角**：
  - 纯领域 Node：零 I/O、零网络、零 Electron API，仅通过 `change(info, ctx)` 推进内部状态或 `ctx.send(nextInfo, targetId)`；
  - 副作用 WorldNode：严格区分**执行类 (`ExecutionWorldNode`)** 与**观察类 (`ObservationWorldNode`)**，物理动作由构造注入的 `EffectAdapter` 执行。

---

## 2. 插件标准契约 (Plugin Contract)

每个插件目录位于 `apps/local-app/plugins/<plugin-id>/`：

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
import { defineBackendPlugin } from '@graphvideo/backend-sdk'

export default defineBackendPlugin({
  id: 'my-plugin',
  // 暴露给前端的安全入口白名单 (必须能静态证明类型)
  rendererRoots: [
    { targetNodeId: 'node-target', infoType: 'ActionRequestedInfo', validate: (info) => Boolean(info) },
  ],
  // 规则空间装载时调用的节点工厂
  createNodes: ({ dependencies }) => [
    new MyDomainNode('node-target', '目标领域节点'),
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
| `src-fs-source` | 观察类源节点 | 接入本地磁盘工程加载 | `ProjectOpenedInfo` (前端入口) | 发送 `ProjectDocumentLoadedInfo` 到 `node-md-source` |
| `node-md-source` | 纯领域 Node | 单调持有 Markdown 源文本与三向安全合并 | `UserMarkdownEditedInfo`<br>`ProjectTreeEditRequestedInfo` | 发送 `MarkdownSourceUpdatedInfo` 到 `node-md-parser` |
| `node-md-parser` | 纯领域 Node | 纯 AST 语法解析器，将 Markdown 解析为节点结构 | `MarkdownSourceUpdatedInfo` | 发送 `ParsedProjectStructureInfo` 到 `node-outliner` |
| `node-outliner` | 纯领域 Node | 大纲层级树管理器，计算排版与层级拓扑 | `ParsedProjectStructureInfo` | 驱动 Outliner 投影更新 |
| `n-hist` | 纯领域 Node | 历史快照与撤回重做中枢 | `UserSnapshotActionInfo` (UNDO/REDO) | 发送还原 Info 覆盖源文档状态 |

#### (2) 持久化与同步组 (Persistence & Database)
| Node ID | 类别 | 职责说明 | 关键输入 Info | 关键输出 / 发送 Info |
| :--- | :--- | :--- | :--- | :--- |
| `node-sqlite` | 纯领域 Node | SQLite 元数据注册表，唯一持有节点属性与媒体版本状态 | `UserMetadataPatchInfo` (前端修改属性)<br>`ArtifactGeneratedInfo` (生成完成) | 触发落盘请求至 `sink-sqlite-writer` |
| `sink-sqlite-writer` | 执行类 WorldNode | 异步落盘写入 `nodes.sqlite` 与磁盘文件 | `SqlitePersistRequestedInfo` | 调用 `sqlitePersistAdapter` 落盘，完成后沉寂 |
| `src-sqlite-observer` | 观察类 WorldNode | 监听外部对 `nodes.sqlite` 的并发修改 | 物理文件变更事件 | 封装为 `ExternalMetadataChangedInfo` 发给 `node-sqlite` |

#### (3) 生成调度与云端流水线组 (Generation Pipeline)
| Node ID | 类别 | 职责说明 | 关键输入 Info | 关键输出 / 发送 Info |
| :--- | :--- | :--- | :--- | :--- |
| `node-sec-gate` | 纯领域 Node | 生成预算与安全网关，拦截超支请求 | `GenerationBudgetConfiguredInfo`<br>`GenerationBatchRequestedInfo` | 验证预算通过后转发给 `node-generation-model-resolver` |
| `node-generation-model-resolver` | 纯领域 Node | 模型参数解析器，将用户提示词结合模型声明装配为 ComfyUI DAG 工作流图 | `GenerationBatchRequestedInfo` (前端生成请求) | 产出 `GenerationExecutionDispatchedInfo` 到 `node-generation-task` |
| `node-generation-task` | 纯领域 Node | 生成任务状态机，维护任务阶段 (WAITING/SUBMITTING/RUNNING/COMPLETED/FAILED) | `GenerationExecutionDispatchedInfo`<br>`GenerationBatchCancelRequestedInfo` | 分发提交指令到 `sink-generation-submit` |
| `sink-generation-submit` | 执行类 WorldNode | 自动将参考素材多部件流式上传至 Comfy Cloud，并向 `/api/prompt` 提交任务获取 Prompt ID | `GenerationSubmitRequestedInfo` | 执行物理 HTTP POST，完成后向调度器发送 `JobSubmittedObservationInfo` |
| `node-generation-poll-scheduler` | 纯领域 Node | 轮询节拍控制器，根据运行中任务动态调整轮询间隔 (退避与节流) | `JobSubmittedObservationInfo` | 定时向 `src-generation-poll` 下发观测脉冲 |
| `src-generation-poll` | 观察类 WorldNode | 轮询云端 GPU 推理状态 `/api/history/{prompt_id}` | 轮询脉冲 | 观察到产物后发送 `JobCompletedObservationInfo` 到任务节点 |
| `sink-generation-download` | 执行类 WorldNode | 流式下载生成图片/视频（如 480p MP4）并保存到本地项目媒体库 | `GenerationDownloadRequestedInfo` | 执行流式下载与文件落盘，发送 `ArtifactGeneratedInfo` 到 `node-sqlite` |

---

### 3.2 前端 Elements 与工作区映射

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
- **ID**: `hello-counter`
- **Node**: `counter-node` (持有 `{ count: number }`)
- **Action**: `CounterIncrementRequestedInfo`
- **特点**: 单个纯领域 Node，无外部副作用，具备确定性 Vitest 测试。

---

## 5. 前端交互速查表（如何发送动作与读取状态）

在编写 Studio 前端或新 Element 时，**直接按此表格查阅**，无需翻看 SDK 或主进程实现：

| 用户操作 | 前端调用的 SDK 命令 / Info | 目标 Node ID | 说明 |
| :--- | :--- | :--- | :--- |
| **打开项目** | `client.submitInfo('src-fs-source', { type: 'ProjectOpenedInfo', project })` | `src-fs-source` | 初始化规则空间并加载工程 |
| **编辑大纲/文本** | `client.submitInfo('node-md-source', { type: 'UserMarkdownEditedInfo', markdown })` | `node-md-source` | 单调演进，自动同步到解析器 |
| **修改节点属性** | `client.submitInfo('node-sqlite', { type: 'UserMetadataPatchInfo', patch: { id, ... } })` | `node-sqlite` | 写入元数据并触发异步落盘 |
| **启动生成** | `client.submitInfo('node-generation-model-resolver', { type: 'GenerationBatchRequestedInfo', batchId, items, project, catalog })` | `node-generation-model-resolver` | 触发预算校验、参数装配与云端提交 |
| **取消任务** | `client.submitInfo('node-generation-task', { type: 'GenerationBatchCancelRequestedInfo', batchId })` | `node-generation-task` | 立即终止轮询与等待 |
| **撤回/重做** | `client.submitInfo('n-hist', { type: 'UserSnapshotActionInfo', action: { type: 'UNDO' } })` | `n-hist` | 历史状态回滚 |
| **设置预算** | `client.submitInfo('node-sec-gate', { type: 'GenerationBudgetConfiguredInfo', maxBudget })` | `node-sec-gate` | 配置最大安全配额 |
