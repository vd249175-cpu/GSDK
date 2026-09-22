---
type: API Reference
title: 内核错误领域规约 (error.rs)
description: KernelError 与 BeginError 枚举定义、错误文案与上层模式匹配契约。
status: stable
tags: [rust, kernel, error, exceptions]
---

# 内核错误领域规约 (`error.rs`)

源码文件：[`packages/rust/kernel/src/error.rs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/error.rs)

内核层所有可失败操作均使用显式、强类型的枚举表达。在跨语言边界（如 Node-API 与 C ABI）处，错误被映射为具体异常或状态码。

---

## 1. 规则空间错误 [`KernelError`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/error.rs#L8-L24)

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KernelError {
    /// 规则空间已关闭，不可重启或接收新操作
    Shutdown,
    /// 尝试准入已存在且活跃的实体 ID
    DuplicateEntity(EntityId),
    /// 尝试操作未准入或已被彻底注销的实体
    UnknownEntity(EntityId),
    /// 元数据或操作指定的代数已落后于当前实体的活跃代数
    StaleGeneration(EntityId),
    /// 实体已绑定至本空间
    AlreadyBound(EntityId),
    /// 实体当前处于繁忙状态：存在活跃的单飞 Change，或正在外部编辑中。
    /// 替换 (replace) 仅允许在单飞间隙执行。
    Busy(EntityId),
}
```

### 错误文案与稳定模式匹配契约
上层 TypeScript SDK 门面（`NativeRuleSpace`）依赖稳定的字符串格式进行重试与错误归类：
- `KernelError::Busy` 的格式化输出为：`"entity busy, replace runs only in the single-flight gap: {id}"`。
  - **契约注意**：TS 侧使用正则 `/\bbusy\b/i` 匹配该错误并进行指数退避重试，该文案严禁随意修改。
- `KernelError::Shutdown` 输出：`"rule space is closed"`。
- `KernelError::DuplicateEntity` 输出：`"entity already admitted: {id}"`。
- `KernelError::UnknownEntity` 输出：`"entity not admitted: {id}"`。
- `KernelError::StaleGeneration` 输出：`"entity generation changed: {id}"`。

---

## 2. 单飞开启错误 [`BeginError`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust/kernel/src/error.rs#L47-L56)

当针对某个特定实体尝试拉取并开启下一个单飞 Change 时（`begin_change`），可能返回如下失败原因：

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BeginError {
    /// 该实体已有单飞任务正在运行，或正持有外部状态编辑锁
    Busy(EntityId),
    /// 实体处于密封状态（封锁新任务执行以准备热替换或卸载）
    Sealed(EntityId),
    /// 实体的 Mailbox 当前为空，无可执行投递
    Empty(EntityId),
}
```

在调用 `poll_next()` 扫描空间时，内核在内部消化 `BeginError`，仅当存在符合单飞条件的实体时返回成功，否则返回 `None`。
