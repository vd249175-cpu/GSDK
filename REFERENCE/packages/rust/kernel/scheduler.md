---
type: API Reference
title: 内核调度器与单飞执行规约 (scheduler.rs)
description: 单飞调度模型、投递反馈、ActiveChange 令牌结算、Submission 状态机与泵循环机制。
status: stable
tags: [rust, kernel, scheduler, single-flight, pump]
---

# 内核调度器与单飞执行规约 (`scheduler.rs`)

源码文件：[`packages/rust/kernel/src/scheduler.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/scheduler.rs)

调度器承担确定性、单线程因果泵循环调度。所有脉冲投递进入目标实体的 Mailbox FIFO 队列，每个实体每次只能处理一个投递（单飞），且被计数的投递必然被结算恰好一次（Exactly-once）。

---

## 1. 核心调度数据类型

### 1.1 投递反馈 [`DeliveryFeedback`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/scheduler.rs#L17-L22)
投递层只描述物理事实，不等待下游 Change 执行，亦不包含业务返回值：
```rust
pub enum DeliveryFeedback {
    /// 成功进入目标 Mailbox
    Enqueued,
    /// 本次未被接纳（目标未知、处于密封态、或任务已取消），附带丢弃原因
    Dropped(DropReason),
}
```

### 1.2 结果标记 [`ChangeOutcome`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/scheduler.rs#L26-L31)
业务层在执行完毕后向内核回传的执行结果：
```rust
pub enum ChangeOutcome {
    /// 正常因果变迁完成
    Completed,
    /// 捕获的业务异常（在 TS 侧被进一步包装为 @error/NodeFailed Info）
    Failed(String),
}
```

### 1.3 只读上下文视图 [`ChangeView`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/scheduler.rs#L35-L52)
交由外部业务 Handler 执行的只读因果上下文：
```rust
pub struct ChangeView {
    pub change_id: ChangeId,
    pub info_id: u64,
    pub caused_by: Option<ChangeId>,
    pub entity: EntityId,
    pub generation: Generation,
    pub info_type: String,
    pub sender: EntityId,
    pub payload_json: Option<String>,
    pub submission: Option<SubmissionId>,
}
```

### 1.4 单飞排他令牌 [`ActiveChange`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/scheduler.rs#L57-L91)
证明当前 Change 正占有该实体的单飞执行权。结算时必须回传：
```rust
pub struct ActiveChange {
    change_id: ChangeId,
    entity: EntityId,
    generation: Generation,
    submission: Option<SubmissionId>,
}
```

### 1.5 根任务生命周期 [`SubmissionState`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/scheduler.rs#L104-L116)
```rust
pub enum SubmissionState {
    /// 存在未结算投递（计数 > 0）
    Open { pending: usize },
    /// 所有派生投递均已结算完毕，无失败与取消
    Completed,
    /// 任务被取消，剩余队列任务在出队时直接丢弃，不予执行
    Cancelled,
    /// 存在业务失败记录
    Failed(String),
}
```

---

## 2. 调度与投递核心接口

### 2.1 脉冲投递 (`send_json` / `inject_root_json`)
- `kernel.send_json(sender, info_type, payload_json, target, caused_by, submission) -> DeliveryFeedback`
  - 检查目标实体是否存在、是否处于密封态（`sealed`）或任务是否已取消；
  - 若不可投递，立即记录到 `drops` 台账并返回 `DeliveryFeedback::Dropped(reason)`；
  - 若可投递，创建 `QueuedInfo` 压入目标 `slot.mailbox`，递增对应 `submission.pending`，返回 `DeliveryFeedback::Enqueued`。
- `kernel.inject_root_json(target, info_type, payload_json, submission) -> DeliveryFeedback`
  - 外部系统向图内注入根脉冲。自动在 `submissions` 中注册该 `submission`，设置 `sender = "external-root"`，调用 `send_json`。

### 2.2 单飞执行开闭 (`begin_change` / `settle_change`)
- `kernel.begin_change(entity) -> Result<(ActiveChange, ChangeView), BeginError>`
  - 尝试开启指定实体的下一个 Change；
  - 若实体已密封返回 `BeginError::Sealed`；若已有活跃 Change 或正在进行外部 State 编辑，返回 `BeginError::Busy`；若队列为空返回 `BeginError::Empty`；
  - 若队列中 Info 携带的代数不匹配当前实体代数（`generation` 发生变化），或 Submission 已取消，自动将其结算为丢弃（`settle_dropped`）并递归消耗；
  - 成功时将实体标记为 `active_change = Some(change_id)`，返回令牌与上下文视图。
- `kernel.settle_change(token, outcome) -> bool`
  - 归还单飞执行权；
  - 校验 `token.change_id` 与 `token.generation` 是否与槽位匹配；
  - 若实体在执行期间被推出（`evict`），则通过墓碑（`Tombstone`）进行最后一次正常结算，保障历史因果链闭合；
  - 释放 `slot.active_change = None`，递减 `submission.pending`，返回 `true`。过期或重复的 token 返回 `false`。

### 2.3 泵循环驱动 (`poll_next` / `pump_once` / `pump_until_idle`)
- `kernel.poll_next() -> Option<(ActiveChange, ChangeView)>`
  - **Node.js/异步宿主专用**：按字典序遍历准入实体，寻找第一个就绪可运行的实体并调用 `begin_change`。外部宿主在处理完毕后（例如执行跨越 `await` 的异步 handler）调用 `settle_change`。
- `kernel.pump_once(body) -> bool`
  - 同步执行一次单飞变化，执行闭包 `body` 并立即结算。
- `kernel.pump_until_idle(body) -> usize`
  - 循环运行直至无任何实体可推进（静止态），返回执行的 Change 总数。

---

## 3. 外部状态干预 (State Intervention)

当宿主或调试控制面需要在单飞间隙同步修改实体的业务 State 时，调度器提供编辑锁原语：
- `kernel.begin_edit(id) -> Result<Generation, KernelError>`：请求锁定。若当前有活跃 Change 或已在编辑中，返回 `KernelError::Busy`。获得编辑锁期间，新消息仍可排队，但不会开启新的 Change。
- `kernel.end_edit(id, generation) -> bool`：释放编辑锁，严格校验 Generation 未发生变化。
- `kernel.abort_edit(id)`：放弃编辑预约。
