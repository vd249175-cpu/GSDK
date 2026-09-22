---
type: API Reference
title: graphframework-kernel-node 本地跨语言绑定规约
description: Node-API / N-API 原生插件规约、RuleSpace 结构、JS 泵循环与 analyze_json 透传。
status: stable
tags: [rust, node-api, napi, kernel-node, native-rule-space]
---

# `graphframework-kernel-node` 本地跨语言绑定规约

源码目录：[`packages/rust/kernel-node/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-node)  
源码入口：[`packages/rust/kernel-node/src/lib.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-node/src/lib.rs)

`graphframework-kernel-node` 是基于 [N-API (napi-rs)](https://napi.rs) 构建的 Node.js 原生 C++ 兼容动态库（`.node`）。它将 Rust 物理规则空间暴露给 Node.js / Electron 宿主，作为 TypeScript SDK 中 [`NativeRuleSpace`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/sdk/javascript/src/node/native-space.ts) 的底层驱动内核。

---

## 1. 跨语言边界职责划分与线程模型

- **Rust 内核负责**：单飞调度决策、实体槽位与 Generation 断代、Mailbox 排队、Submission 状态跟踪、丢弃台账、因果 ID 唯一性生成。
- **JavaScript/TypeScript 宿主负责**：持有业务 State、执行 Node 变化体（Change Handler）、驱动主泵循环（Event Loop）。
- **零跨线程锁竞争**：
  - 所有导出的 Node-API 方法均在 JavaScript 主线程同步执行；
  - 内部使用 `std::sync::Mutex<Kernel>` 保护内核实例；
  - 由于没有后台 Rust 线程主动跨边界唤醒，因此在规则空间卸载或关闭时，零需要等待汇聚的后台线程（Nothing to join on release）。
- **数值精度安全契约**：
  - Rust 内部的因果 ID（`u64`）在跨边界进入 JavaScript 时转换为 `f64`；
  - 规范保证在 JavaScript 安全整数区间（小于 $2^{53} - 1$）内无精度丢失。

---

## 2. 导出类型与 DTO 结构

所有与 JavaScript 互操作的对象均声明为纯数据传输对象（DTO）：

### 2.1 任务执行相关
- [`JsChangeToken`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-node/src/lib.rs#L63-L68)：结算令牌 `{ change_id, entity, generation, submission }`。
- [`JsChangeView`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-node/src/lib.rs#L72-L82)：交由 JS 执行的只读视图 `{ change_id, info_id, caused_by, entity, generation, info_type, sender, payload_json, submission }`。
- [`JsPolledChange`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-node/src/lib.rs#L86-L89)：`poll_next()` 的返回包 `{ token: JsChangeToken, view: JsChangeView }`。

### 2.2 物理反馈与可观测性
- [`JsDeliveryFeedback`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-node/src/lib.rs#L54-L58)：发送即时反馈 `{ status: "enqueued" | "dropped", reason?: string }`。
- [`JsDroppedDelivery`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-node/src/lib.rs#L93-L98)：丢弃项 `{ target, generation, submission, reason }`。
- [`JsQueuedDepth`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-node/src/lib.rs#L102-L105)：队列深度 `{ entity, depth }`。
- [`JsQueuedInfo`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-node/src/lib.rs#L108-L117)：排队明细快照。
- [`JsAnalysisFacts`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-node/src/lib.rs#L120-L123)：实体分析事实 `{ entity, facts_json }`。

---

## 3. `RuleSpace` 核心类方法原型

```ts
export class RuleSpace {
  constructor();

  shutdown(): void;
  admit(id: string): number;
  evict(id: string): boolean;
  seal(id: string): void;
  unseal(id: string): void;
  replace(id: string): number;
  generation(id: string): number | null;

  setAnalysisFacts(id: string, generation: number, factsJson: string): void;
  analysisFacts(): JsAnalysisFacts[];

  beginEdit(id: string): number;
  endEdit(id: string, generation: number): boolean;
  abortEdit(id: string): void;

  send(
    sender: string,
    infoType: string,
    payloadJson: string | null,
    target: string,
    causedBy: number | null,
    submission?: string,
  ): JsDeliveryFeedback;

  injectRoot(
    target: string,
    infoType: string,
    payloadJson: string | null,
    submission: string,
  ): JsDeliveryFeedback;

  pollNext(): JsPolledChange | null;
  settleChange(token: JsChangeToken, failedMessage: string | null): boolean;

  cancel(submission: string): boolean;
  submissionState(submission: string): string | null;
  pendingTotal(): number;
  queuedDepths(): JsQueuedDepth[];
  queuedInfos(): JsQueuedInfo[];
  drops(): JsDroppedDelivery[];
  admittedEntities(): string[];
}
```

---

## 4. JS 侧泵驱动实现机制

TypeScript SDK 中的泵循环（Pump Loop）通过如下方式与 Node-API 协作驱动：

```ts
// 典型异步泵循环驱动片段
while (true) {
  const polled = space.pollNext();
  if (!polled) break; // 规则空间无就绪单飞任务，达到当前静止态

  const { token, view } = polled;
  let failedMessage: string | null = null;
  try {
    // 跨越业务的同步或异步 handler 执行
    await registeredNode.handler(view, ctx);
  } catch (err) {
    // 异常不击穿微内核，转换为 @error/NodeFailed 并捕获失败事实
    failedMessage = err instanceof Error ? err.message : String(err);
  } finally {
    // 严密单次结算，归还单飞执行权
    space.settleChange(token, failedMessage);
  }
}
```

---

## 5. 分析引擎统一入口透传 [`analyze_json`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel-node/src/lib.rs#L446-L452)

`graphframework-kernel-node` 导出了模块级静态函数 `analyze_json`：
```rust
#[napi]
pub fn analyze_json(request_json: String, facts_json: String) -> Result<String>
```
- **架构职责**：零算法逻辑。它纯粹作为 N-API 的轻量字符串转发外壳，将 JSON 请求和节点快照切分为 `(facts, context)`，直接委托调用 `graphframework_analysis::analyze_json`。
- **输出保障**：返回经过键排序的确定性 JSON 结果字符串。
