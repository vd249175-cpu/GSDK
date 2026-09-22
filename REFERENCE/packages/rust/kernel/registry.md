---
type: API Reference
title: 实体注册表与丢弃台账规约 (registry.rs)
description: EntitySlot 结构、Generation 破坏性断代、Mailbox FIFO 队列、Tombstone 墓碑与丢弃台账。
status: stable
tags: [rust, kernel, registry, mailbox, generation, tombstone]
---

# 实体注册表与丢弃台账规约 (`registry.rs`)

源码文件：[`packages/rust/kernel/src/registry.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/registry.rs)

注册表管理物理实体的生命周期、槽位状态、Mailbox 队列及历史墓碑。其核心铁律是：**状态与队列绝不跨越实体生命周期；推出或替换时，丢弃旧队列并递增代数，新实例干净启动**。

---

## 1. 实体槽位 [`EntitySlot`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/registry.rs#L66-L78)

每个准入的 Node 在微内核中独占一个 `EntitySlot`：

```rust
pub struct EntitySlot {
    /// 当前代数（从墓碑计数器派生，每次替换自增）
    pub generation: Generation,
    /// 替换密封标记：密封期间队列冻结，不开启新 Change，新发送直接丢弃
    pub sealed: bool,
    /// 外部状态编辑预约标记
    pub edit_requested: bool,
    /// 是否正处于外部状态编辑中
    pub editing: bool,
    /// FIFO 消息邮箱
    pub mailbox: VecDeque<QueuedInfo>,
    /// 当前正在执行的单飞 ChangeId
    pub active_change: Option<ChangeId>,
}
```

---

## 2. 队列脉冲 [`QueuedInfo`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/registry.rs#L44-L61)

等待处理的单条因果投递结构：

```rust
pub struct QueuedInfo {
    pub info_id: InfoId,
    pub sender: EntityId,
    pub target: EntityId,
    pub info_type: String,
    pub payload_json: Option<String>,
    pub generation: Generation,
    pub caused_by: Option<ChangeId>,
    pub submission: Option<SubmissionId>,
}
```

---

## 3. 墓碑机制 [`Tombstone`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/registry.rs#L96-L101)

当实体被推出（`evict`）或替换（`replace`）时，其历史槽位被销毁，但在注册表中保留一个轻量 `Tombstone`：
- 记录最后的 `generation`（避免重新准入同名 ID 时代数冲突）；
- 若推出瞬间该实体恰好有在途的单飞任务，记录其 `active_change`，允许旧任务正常执行完毕并通过墓碑单次结算（Exactly-once），防止悬挂执行或因果链断裂；
- 墓碑结算完成后清除记录。

---

## 4. 投递丢弃动因 [`DropReason`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/registry.rs#L14-L27)

因果脉冲未到达最终业务 Handler 的六大物理归因：

| 动因枚举 | 字符串标识 | 发生场景 |
| :--- | :--- | :--- |
| `KernelShutdown` | `"kernel-shutdown"` | 规则空间已关闭，拒绝新投递 |
| `UnknownTarget` | `"unknown-target"` | 目标实体从未准入，或已被完全注销 |
| `SealedTarget` | `"sealed-target"` | 目标实体正处于 `seal` 状态（热替换或平稳卸载准备中） |
| `StaleGeneration` | `"stale-generation"` | 消息在队列中排队期间，目标实体发生了 `replace` 或重新准入，代数已不符 |
| `Cancelled` | `"cancelled"` | 脉冲所属的根 Submission 已被主动调用 `cancel` 取消 |
| `Evicted` | `"evicted"` | 实体执行 `evict` 或 `replace` 时，旧 Mailbox 中的存量 Backlog 被整批物理丢弃 |

每条被丢弃的投递均记录进丢弃台账 [`DroppedDelivery`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/registry.rs#L31-L40)，保留完整因果上下文供调试排查。

---

## 5. 注册表操作生命周期

- `admit(id)`：
  - 若已存在报错 `KernelError::DuplicateEntity`；
  - 继承历史墓碑代数 + 1（首次准入则为 1）；
  - 创建空白槽位，返回其实际代数。
- `evict(id)`：
  - 移除槽位，提取全部排队队列并转交调度器转记丢弃台账；
  - 墓碑递增代数，在途任务转移至墓碑。
- `replace(id)`：
  - 必须在单飞间隙执行（若 `active_change.is_some()` 则报错 `KernelError::Busy`）；
  - 丢弃积压队列，槽位代数自增，清空编辑标记，原位重置为空白状态。
