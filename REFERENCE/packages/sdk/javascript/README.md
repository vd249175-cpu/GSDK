---
type: Developer Guide
title: JavaScript / TypeScript SDK 全量接口指南 (packages/sdk/javascript)
description: TS/JS SDK 全景接口规约：Node/WorldNode 基类、Change 上下文方法全集、NativeRuleSpace API 与单元测试 Harness。
status: stable
tags: [sdk, typescript, node, testing, effect-adapter, context-methods, native-rule-space]
---

# JavaScript / TypeScript SDK 全量接口指南 (`packages/sdk/javascript`)

源码目录：[`packages/sdk/javascript/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/sdk/javascript)

本指南列出 TypeScript SDK 导出的**全部核心类、接口方法与上下文操作**，实现 100% 无遗漏覆盖，开发者读完即可直接上手进行业务开发。

---

## 1. 核心导出与命名空间速查

```ts
import {
  Node,                         // 纯领域节点基类
  ExecutionWorldNode,           // 物理执行类节点基类
  ObservationWorldNode,         // 物理观察类节点基类
  NativeRuleSpace,              // 原生规则空间主实例
  mountDomainNode,              // 挂载节点辅助函数
  replaceDomainNode,            // 替换节点辅助函数
  describeDomainNode,           // 读取节点自描述元数据
  type Info,                    // 因果脉冲通用结构
  type DomainChangeContext,     // 纯领域变化上下文
  type ExecutionChangeContext,  // 物理执行变化上下文
  type ObservationChangeContext,// 物理观察变化上下文
} from '@graphframework/sdk/node';

import {
  type EffectAdapter,           // 物理副作用适配器接口
  defineEffectAdapter,          // 构造适配器工厂
} from '@graphframework/sdk/effect';

import {
  createNodeTestingHarness,     // 节点纯内存单测工具
  type NodeTestingHarness,
} from '@graphframework/sdk/testing';
```

---

## 2. 节点变化体上下文接口全集 (`ChangeContext`)

在 Node 的 `change(info, ctx)` 内部，`ctx` 提供以下原子操作方法（无一遗漏）：

| 上下文方法 | 适用节点分类 | 参数与签名 | 行为与物理契约 |
| :--- | :--- | :--- | :--- |
| **`ctx.read(key)`** | 全部节点 | `key: keyof State` | 读取本节点当前 State 中的指定字段值。只读操作。 |
| **`ctx.write(key, value)`** | 全部节点 | `key: keyof State, value: any` | 原子写入并更新本节点指定字段。立即在当前单飞中生效。 |
| **`ctx.patchState(patch)`** | 全部节点 | `patch: Partial<State>` | 批量原子合并更新本节点的多个 State 字段。 |
| **`ctx.send(info, targetNodeId)`** | 全部节点 | `info: Info, targetNodeId: string` | **节点间唯一合法的通信手段**。返回 `{ status: "enqueued" \| "dropped", reason? }`。 |
| **`ctx.effectAdapter(adapter, request, options?)`** | 仅 `ExecutionWorldNode` | `adapter: EffectAdapter<Req, Obs>, request: Req, options?: { signal?: AbortSignal }` | **下发外部物理 I/O**。异步等待物理世界的返回结果，获得 Observation。其他节点严禁调用。 |
| **`ctx.span(name, action)`** | 全部节点 | `name: string, action: () => Promise<T> \| T` | 创建命名执行性能耗时切片，用于遥测追踪。 |

---

## 3. 规则空间操作方法全集 (`NativeRuleSpace`)

[`NativeRuleSpace`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/sdk/javascript/src/node/native-space.ts) 承载着上层与 Rust 原生微内核的完整交互：

### 3.1 节点生命周期
- `space.mountDomainNode(node)`: 装配并准入一个新节点。
- `space.replaceNode(nodeId, newNode)`: 在单飞间隙原子热替换节点，自动换代并清空旧积压队列。
- `space.evict(nodeId, options?: { timeoutMs?: number })`: 优雅注销节点，等待其在途 Change 执行完毕并执行清理。
- `space.seal(nodeId)` / `space.unseal(nodeId)`: 临时密封/解封节点 Mailbox。

### 3.2 任务注入与调度
- `space.injectRootInfo(targetNodeId, info, submissionId)`: 从图外注入根脉冲，启动一个以 `submissionId` 归属的因果链路。
- `space.cancelSubmission(submissionId)`: 一键取消指定根任务批次。
- `space.getSubmissionState(submissionId)`: 查询批次生命周期状态（`"open:N"`, `"completed"`, `"cancelled"`, `"failed:..."`）。
- `space.waitForQuiescence(timeoutMs?: number)`: 异步等待全图所有节点均达到静止态（队列无积压、无在途 Change）。

### 3.3 状态观测与控制面干预
- `space.getState(nodeId)`: 获取指定节点当前的只读 State 字典快照。
- `space.getGeneration(nodeId)`: 获取指定节点当前的活跃代数（Generation）。
- `space.readProjection()`: 读取全图所有节点的只读状态投影集合。
- `space.readStaticTopology()`: 读取静态解析出的节点与因果路由拓扑。
- `space.interveneState(nodeId, mutator, options?)`: **控制面单飞间隙状态修改**。传入 `mutator(currentState)` 函数进行原子热修改。

### 3.4 拓扑分析与停机
- `space.analyze(request)`: 传入分析操作对象（如 `{ op: "health" }`），直接在微内核内部调用高性能分析引擎。
- `space.shutdown()`: 优雅停机。在无活跃节点和任务时安全注销微内核。
- `space.dispose(options?)`: 组合清理。取消所有未决任务、逐个卸载所有节点并关闭底层规则空间。

---

## 4. 纯内存单测 Harness 接口全集 (`NodeTestingHarness`)

由 `createNodeTestingHarness(node)` 构造，提供以下测试断言辅助接口：

| 测试方法 | 返回类型 | 功能说明 |
| :--- | :--- | :--- |
| `await harness.send(info)` | `Promise<void>` | 向测试节点灌入一条 Info 脉冲，并等待其 `change` 逻辑完全执行完毕。 |
| `harness.readState(key?)` | `any` | 读取节点当前的特定状态字段值（或整个 State 快照）。 |
| `harness.getSentInfos()` | `Array<{ info, targetNodeId }>` | 获取在当前测试轮次中，该节点通过 `ctx.send` 发送的所有脉冲记录。 |
| `harness.getSentTo(targetId)` | `Info[]` | 筛选出发往特定目标节点的所有脉冲列表。 |
| `harness.clearSent()` | `void` | 清空已记录的发送历史，便于进行下一轮断言。 |
