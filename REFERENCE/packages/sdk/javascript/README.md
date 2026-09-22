---
type: API Reference
title: JavaScript / TypeScript SDK 公开接口
description: 七个公开子路径、change context、NativeRuleSpace、插件与测试能力的源码对齐接口表。
status: stable
tags: [sdk, typescript, public-api, node, testing, native-rule-space]
---

# JavaScript / TypeScript SDK 公开接口

开始开发、最小示例与验收命令见 [SDK 开发入口](../README.md)。本页只回答“从哪里导入、可调用什么”。消费者不得导入 `packages/sdk/javascript/src/**`。

## 1. 七个稳定子路径

| 子路径 | 主要公开 API |
| :--- | :--- |
| `@graphframework/sdk/protocol` | `Info`、change/projection/telemetry DTO、`defaultValueCodec`、daemon value codec、机器契约常量 |
| `@graphframework/sdk/node` | `Node`、`WorldNode`、`ExecutionWorldNode`、`ObservationWorldNode`、contexts、`KernelRuntime`（测试 Oracle）、`NativeRuleSpace`、原生/daemon/process node 桥接 |
| `@graphframework/sdk/effect` | `EffectAdapter`、`EffectContext`、daemon effect provider |
| `@graphframework/sdk/plugin` | Node 基类重导出、工厂、`BackendPlugin`、renderer root 校验、Manifest 解析 |
| `@graphframework/sdk/analysis` | 实例/便携事实、索引、查询、路径、视图、健康度、可达性、中心性与社区算法 |
| `@graphframework/sdk/agent` | `KernelDaemonClient` 与 `connectKernelDaemon` |
| `@graphframework/sdk/testing` | `createTestRuntime`、`EffectHarness` 及其类型 |

包根 `@graphframework/sdk` 不导出 API；必须选择能力面，避免浏览器代码意外打包 Node/Rust 宿主依赖。

## 2. change context

| API | 允许位置 | 返回/效果 |
| :--- | :--- | :--- |
| `ctx.read(key)` | 所有 Node | 读取 Owner State 字段 |
| `ctx.write(key, value)` | 所有 Node | 在当前 change 写一个字段 |
| `ctx.patchState(patch)` | 所有 Node | 在当前 change 合并多个字段 |
| `ctx.send(info, targetNodeId)` | 所有 Node | 返回 `DeliveryFeedback`；唯一节点通信路径 |
| `await ctx.span(name, action)` | 所有 Node | 执行 action 并记录耗时 span |
| `await ctx.effectAdapter(adapter, request, options?)` | WorldNode | 执行构造注入的 `EffectAdapter`；纯 Node 调用会报架构错误 |

类型选择：纯领域 Node 使用 `DomainChangeContext<State>`；WorldNode 使用 `WorldChangeContext<State>`。公开 API 中没有 `ExecutionChangeContext`、`ObservationChangeContext` 或 `defineEffectAdapter`。

## 3. NativeRuleSpace

生产调度只使用 Rust-backed `NativeRuleSpace`。常用公开成员按职责分组如下：

| 职责 | 成员 |
| :--- | :--- |
| 准入/替换 | `register`、`unregister`、`evict`、`replace`；类 Node 使用 `mountDomainNode` / `replaceDomainNode` 辅助函数 |
| 注入/结算 | `injectRoot`、`waitForSubmission`、`submissionState`、`cancel`、`pump` |
| 状态/控制面 | `getState`、`generation`、`admittedEntities`、`interveneState` |
| 观察 | `readProjection`、`subscribeProjection`、`readCausalEvents`、`subscribeCausalEvents`、`readStaticTopology` |
| 队列/丢弃 | `pendingTotal`、`queuedDepths`、`readPendingInfos`、`drops` |
| 生命周期 | `waitForDisposals`、`shutdown`、`dispose` |

`interveneState` 必须携带 actor、reason、预期 generation 与 version；普通业务变迁仍只能通过 Info 进入 Owner Node。

## 4. 测试入口

```ts
import { createTestRuntime, EffectHarness } from '@graphframework/sdk/testing';
```

`createTestRuntime({ nodes? })` 返回：`kernel`、`inject`、`injectRootInfo`、`waitForQuiescence`、`getState`、`getNode`、`readProjection`、`createProjection`、`dispose`。它使用冻结的 TypeScript 规约，仅用于局部测试，不是生产内核。

`EffectHarness` 用显式 fixture 包装 adapter 调用，记录请求、观察结果与诊断摘要。源码没有 `createNodeTestingHarness` 或 `NodeTestingHarness`。

## 5. 公开导出变更规则

新增能力必须从所属 `src/<face>/index.ts` 导出。新增“能力面”才同时修改 `package.json#exports` 与 `vite.dist.config.ts`；向现有能力面增加成员不应新建深层子路径。提交前运行：

```bash
npm --prefix packages/sdk/javascript run typecheck
npm --prefix packages/sdk/javascript test
```
