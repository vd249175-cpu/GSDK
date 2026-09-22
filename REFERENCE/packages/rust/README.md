---
type: Architecture Specification
title: Rust 原生微内核与规则空间使用指南 (packages/rust)
description: 面向开箱即用的物理规则空间与因果分析引擎使用说明，零代码直接运行、JSON 数据驱动与黑盒操作接口。
status: stable
tags: [rust, kernel, quick-start, zero-code, json-interface, daemon, analysis]
---

# Rust 原生微内核与规则空间使用指南 (`packages/rust`)

`packages/rust` 是 GraphFramework 的核心动力总成。

**本指南的目的是：让你在不阅读任何 Rust 源码、不开发任何 C++/Rust 底层代码的前提下，直接把这套高性能微内核与因果分析能力“开箱即用”地跑起来。**

---

## 1. 它是做什么的？（一句话定位）

它是一个**纯数据驱动的物理因果执行与调度黑盒**：
- **为你解决并发灾难**：无论外部多少事件并发涌入，它保证每个节点内部永远**单飞执行（Single-flight）**，绝不产生数据竞争与脏写；
- **为你兜底系统容灾**：任何业务逻辑报错，它自动转化为标准因果事件（`@error/NodeFailed`），**系统永不崩溃**，因果链不断裂；
- **自带高维分析大脑**：你只需把系统当前的 JSON 结构丢给它，它瞬间为你计算出**全图健康度、因果死锁环路、性能瓶颈咽喉与子系统模块划分**。

你只需要学会：**如何启动它、如何向它发送 JSON 任务指令、以及如何获取结果。**

---

## 2. 零代码上手：3 种开箱即用的使用方式

### 方式 A：作为常驻守护进程直接运行（跨语言/命令行黑盒模式）

无需编译 Node 插件或链接动态库，直接通过标准输入输出（STDIN/STDOUT）以单行 JSON 报文进行交互：

```bash
# 1. 启动守护进程（通过 Cargo 或根目录运行环境）
cargo run -p graphframework-kernel-daemon -- --stdio
```

启动后，在控制台直接输入指令（单行 JSON）即可完成全生命周期管理：

#### ① 注册一个实体节点（初始化状态）
```json
{"action": "admit", "nodeId": "downloader", "state": {"downloadedBytes": 0, "status": "idle"}}
```
> **输出反馈**：`{"ok": true, "generation": 1}`

#### ② 注入外部脉冲触发任务
```json
{"action": "inject_root", "target": "downloader", "infoType": "StartDownload", "payload": {"url": "https://example.com/data.bin"}, "submission": "task-001"}
```
> **输出反馈**：`{"ok": true, "status": "enqueued"}`（立即确认已安全进入队列，无需等待耗时下载完成）

#### ③ 查询任务当前推进状态
```json
{"action": "submission_state", "submission": "task-001"}
```
> **输出反馈**：`{"ok": true, "state": "open:1"}`（表示该任务正在运行，当前还有 1 个派生步骤待结算）

#### ④ 一键取消正在运行的任务
```json
{"action": "cancel_submission", "submission": "task-001"}
```
> **输出反馈**：`{"ok": true, "cancelled": true}`（微内核自动丢弃队列中剩余未执行的步骤，保证无资源泄漏）

---

### 方式 B：直接用作因果图拓扑与健康度分析器（诊断引擎模式）

如果你已经有一份业务系统的快照数据（`facts.json`），你**完全不需要启动微内核调度器**，可以直接调用内置的分析引擎进行静态体检：

#### ① 一键检测系统健康度（发现死锁环路、孤立节点、源/汇分布）
- **输入请求**：
  ```json
  { "op": "health" }
  ```
- **输出报告**：
  ```json
  {
    "nodeCount": 8,
    "routeCount": 15,
    "density": 0.267,
    "cyclicNodeIds": [],            // 若为空说明系统健康无死循环；若有节点则直接标红告警
    "isolatedNodeIds": [],          // 发现完全没有接线的废弃僵尸节点
    "sourceNodeIds": ["scheduler"], // 系统事件入口
    "sinkNodeIds": ["storage"]      // 最终落盘出口
  }
  ```

#### ② 计算系统性能单点与枢纽瓶颈（介数中心性）
- **输入请求**：
  ```json
  { "op": "centrality" }
  ```
- **输出报告**：直接输出每个节点作为“交通咽喉”的介数得分（`betweenness`），分值最高的节点即为系统的单点瓶颈与重点优化对象。

#### ③ 自动发现子系统边界（Louvain 社区发现算法）
- **输入请求**：
  ```json
  { "op": "communities" }
  ```
- **输出报告**：算法根据节点间交互频次，自动聚类出高内聚子系统（如 `["auth-node", "user-node"]` 与 `["order-node", "payment-node"]`），帮助架构师重构代码边界。

---

### 方式 C：在 TypeScript / Node.js 宿主中开箱即用

对于前端桌面（Electron）或后端 Node.js 开发者，底层 Rust 已经预编译为 N-API 原生模块（`graphframework-kernel-node`），通过 SDK 直接实例化：

```ts
import { NativeRuleSpace } from '@graphframework/sdk/node';

// 1. 创建即用的物理规则空间
const space = new NativeRuleSpace();

// 2. 装配你的业务节点
space.mountDomainNode(myWorkerNode);

// 3. 注入外部启动事件并获得即时投递反馈
const feedback = space.injectRootInfo('downloader', {
  type: 'StartDownload',
  url: 'https://example.com/file.zip'
}, 'sub-001');

console.log(feedback); // { status: 'enqueued' }
```

---

## 3. 使用者视角的核心操作指令字典（黑盒交互契约）

无论你通过哪种语言或协议与微内核交互，底层统一支持以下 7 项核心操作：

| 你想做什么 | 调用的操作名 | 你需要提供的参数 | 你将获得的结果 |
| :--- | :--- | :--- | :--- |
| **装配/准入实体** | `admit` | 实体标识 `nodeId` | 该实体的代数 `generation: 1` |
| **发送因果事件** | `send` | `sender`, `target`, `infoType`, `payload` | `{ status: "enqueued" }` 或 `{ status: "dropped", reason }` |
| **从外部注入根任务** | `inject_root` | `target`, `infoType`, `payload`, `submission` | 立即确认排队成功，建立该 `submission` 的因果追踪 |
| **查询任务生命周期** | `submission_state`| 任务标识 `submission` | `"open:N"`（运行中）、`"completed"`（已完成）、`"cancelled"`（已取消）、`"failed:原因"` |
| **取消任务批次** | `cancel` | 任务标识 `submission` | 取消成功标记；剩余积压任务自动跳过不执行 |
| **免重启热调节点状态** | `intervene` | `nodeId`, `statePatch` | 在执行间隙无感写入新状态，不打断因果流 |
| **全图拓扑与健康体检** | `analyze` | 分析操作 `{ "op": "health" \| "path" \| ... }` | 完整的结构化分析 JSON 报告 |

---

## 4. 微内核为你提供的“天然安全守卫”

你不需要编写代码去防御并发、死锁或异常，微内核在底层默默为你保证：

1. **单飞排他保证 (Single-flight Safety)**：
   - 任何一个 Node 绝对不会在同一时刻执行两个 Change。所有到来的事件在 Mailbox 队列中严格 FIFO 排队，天然杜绝数据竞争，无需加应用层锁。
2. **异常同权与自愈 (Error as Info)**：
   - 某个 Node 里的业务代码抛出了异常？微内核绝对不会崩溃退出。异常会被自动捕获为一条 `@error/NodeFailed` 事件继续在因果链中流转，可供下游监听、告警或重试。
3. **断代热替换 (Generation Discontinuity)**：
   - 当你在运行时替换或更新某个 Node 时，微内核会自动销毁旧实例并递增代数（Generation）。所有陈旧、积压的旧事件在出队时会被自动识别并作为“过期待数”丢弃进台账，绝不污染新实例。
4. **平稳优雅关机 (Quiescent Shutdown)**：
   - 只要有未完成的计算任务，微内核绝不会暴力退市；调用停机指令时，它会确认任务已全部结算并完成资源回收。

---

## 5. 跨语言统一接口映射对照表（开发者速查）

如果你正在开发特定语言的胶水层，使用下表快速定位对应语言的接口调用方式：

| 逻辑动作 | Rust 核心 (`Kernel`) | Node-API (`RuleSpace`) | TypeScript (`NativeRuleSpace`) | C ABI (`GvKernel`) | Daemon JSON 协议 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 准入节点 | `admit(id)` | `space.admit(id)` | `space.mountDomainNode(n)` | `gv_kernel_admit(...)` | `{"action": "admit", ...}` |
| 外部注入 | `inject_root_json(...)` | `space.injectRoot(...)` | `space.injectRootInfo(...)`| `gv_kernel_inject_root(...)`| `{"action": "inject_root", ...}` |
| 状态查询 | `submission_state(sub)` | `space.submissionState(sub)` | `space.getSubmissionState(sub)` | `gv_kernel_submission_state(...)` | `{"action": "submission_state", ...}` |
| 任务取消 | `cancel(sub)` | `space.cancel(sub)` | `space.cancelSubmission(sub)` | `gv_kernel_cancel(...)` | `{"action": "cancel_submission", ...}` |
| 状态干预 | `begin_edit` / `end_edit` | `beginEdit` / `endEdit` | `space.interveneState(...)` | *(扩展 C ABI)* | `{"action": "intervene", ...}` |
| 运行分析 | `analyze_json(...)` | `analyze_json(...)` | `space.analyze(req)` | `gv_analyze_json(...)` | `{"action": "analyze", ...}` |

---

## 6. 底层代码实现深入索引（供内核维护者查阅）

如果你需要修改 Rust 微内核源码、扩展算法或排查调度器缺陷，请参阅以下详细源码解剖文档：

- [`kernel/` 调度器核心实现](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/kernel/README.md)：
  - [单飞执行与泵循环 (`scheduler.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/kernel/scheduler.md)
  - [实体注册表与丢弃台账 (`registry.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/kernel/registry.md)
  - [错误类型与模式匹配 (`error.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/kernel/error.md)
- [`kernel-node/` N-API 跨语言绑定](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/kernel-node/README.md)：Node.js 动态链接与浮点数值安全转换。
- [`kernel-ffi/` C ABI 导出](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/kernel-ffi/README.md)：面向 Python ctypes / C++ 的函数原型与内存管理。
- [`kernel-daemon/` 常驻守护进程](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/kernel-daemon/README.md)：多 Session 租约与分布式副作用（Effect）委派。
- [`analysis/` 拓扑分析引擎算法](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/analysis/README.md)：
  - [因果实体模型 (`model.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/analysis/model.md)
  - [图算法与健康度度量 (`metrics.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/analysis/metrics.md)
  - [因果切片查询 (`query.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/analysis/query.md)
  - [拓扑视图与层级折叠 (`views.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/analysis/views.md)
