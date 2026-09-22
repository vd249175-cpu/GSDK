---
type: Architecture Specification
title: graphframework-kernel 核心微内核规约
description: GraphFramework 核心微内核架构、Kernel 结构体、物理因果调度与停机契约。
status: stable
tags: [rust, kernel, scheduler, physical-rule-space]
---

# `graphframework-kernel` 核心微内核规约

[`packages/rust/kernel`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel) 是全仓物理规则空间的绝对核心。该 Crate 纯由 Rust 实现，零第三方重型依赖，完全不包含任何业务语义。

业务代码（如 TypeScript 实体、Python 实体或测试桩）运行于内核外部，该 Crate 仅负责**因果投递的排他调度、单飞执行（Single-flight Execution）、实体生命周期准入与精确一次结算（Exactly-once Settlement）**。

---

## 1. 基础因果类型标识

在 [`packages/rust/kernel/src/lib.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/lib.rs#L1-L10) 中定义了五项核心因果类型别名：

```rust
/// 稳定实体唯一标识符（对应 TS 中的 nodeId）
pub type EntityId = String;

/// 根任务与溯源批次标识符（对应 TS 中的 submissionId）
pub type SubmissionId = String;

/// 因果 Change 全局递增唯一标识
pub type ChangeId = u64;

/// 因果 Info 脉冲全局递增唯一标识
pub type InfoId = u64;

/// 实体代数（Generation）：每次 evict/replace 强制自增且永不复用
pub type Generation = u64;
```

---

## 2. `Kernel` 核心结构体与生命周期

[`Kernel`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/scheduler.rs#L125-L135) 是整个规则空间的主状态机：

```rust
#[derive(Debug, Default)]
pub struct Kernel {
    closed: bool,
    registry: Registry,
    analysis_facts: BTreeMap<EntityId, String>,
    submissions: BTreeMap<SubmissionId, Submission>,
    drops: Vec<DroppedDelivery>,
    next_info: u64,
    next_change: ChangeId,
}
```

### 空间停机契约 (`shutdown`)
- **前置条件**：调用 `shutdown()` 时，规则空间必须满足：
  1. 注册表中无任何存活实体（`registry.ordered_ids().is_empty()`）；
  2. 无任何在途单飞任务（`!registry.has_in_flight()`）；
  3. 全局无任何未决投递（`self.pending_total() == 0`）。
- **违约错误**：若空间仍有节点或未结算 change，返回 [`KernelError::Busy`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/error.rs#L23)。
- **停机行为**：将 `closed` 置为 `true`，清空分析元数据。关闭后拒绝一切 `admit` 与 `send`，重复调用安全幂等返回 `Ok(())`。

---

## 3. 全局内省与可观测性接口

内核提供确定性的内省接口，供上层控制面、可视化器与健康检查读取：

| 方法 | 返回类型 | 说明 |
| :--- | :--- | :--- |
| `kernel.admitted_entities()` | `Vec<EntityId>` | 按字典序升序返回所有当前准入实体的 ID 清单 |
| `kernel.active_changes()` | `Vec<(EntityId, ChangeId, Generation)>` | 当前所有节点正在运行的单飞 Change 列表 |
| `kernel.pending_total()` | `usize` | 跨所有 Submission 统计的全局未决投递总量 |
| `kernel.queued()` | `Vec<QueuedView>` | 按实体准入顺序返回各节点当前 Mailbox 堆积深度 |
| `kernel.queued_infos()` | `Vec<QueuedInfo>` | 获取待处理队列快照（含 Payload 与因果溯源标识） |
| `kernel.drops()` | `&[DroppedDelivery]` | 按结算顺序获取丢弃台账（Drop Ledger） |

---

## 4. 详细模块导航

微内核实现拆分为三大核心文件：

- [调度引擎与泵循环 (`scheduler.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/kernel/scheduler.md)：单飞执行开闭、`ActiveChange` 令牌、`DeliveryFeedback` 物理反馈与 `Submission` 状态机。
- [实体注册表与丢弃台账 (`registry.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/kernel/registry.md)：`EntitySlot`、`Mailbox`、破坏性断代（Generation）、`Tombstone` 墓碑与 `DropReason`。
- [内核错误领域规约 (`error.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/kernel/error.md)：`KernelError` 与 `BeginError` 错误枚举及文案模式匹配约定。
