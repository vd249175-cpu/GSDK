---
type: Architecture Specification
title: 命名 run 生命周期
description: run.sh 启停阶段、活动快照、关闭语义与 generation 破坏性断代机制。
status: stable
tags: [lifecycle, generation, state-machine, runtime]
---

# 命名 run 生命周期

一个 run 的生命周期完全由根目录 `run.sh` 驱动，Bash 独占编排顺序，`packages/tooling/run/src` 只做单阶段操作。阶段常量见 `packages/tooling/run/src/lifecycle.mjs`：

```text
START_STAGES = validate → lock → kernel-ready → hosts-ready → assembled
  → admitted → workers-ready → initialized → started
STOP_STAGES = stopping → settled → evicted → kernel-stopped → hosts-stopped → closed
```

`createEmptyNativeGraphHost`（`packages/desktop/host/native-graph-host.mjs`）创建空 Rust 规则空间，`mountPlugins` 装配调用方传入的普通插件节点，业务由另行注入的 Info 推进。`NativeRuleSpace.shutdown` 不隐式卸载节点或保存数据；正常停机先结算业务，再显式推出节点，最后关闭空规则空间。

## 启动顺序

`packages/tooling/run/supervisor.sh` 按以下顺序推进，任一阶段失败即按关闭路径回滚已获资源并以非零退出：

```text
prepare（校验配置 + 原子取得 run.lock + 写 environment.sh/快照）
→ 启动空 Rust kernel-daemon，等待 RPC ready（kernel-ready）
→ 启动后端宿主，确认可装配（hosts-ready）
→ assemble：解析选中的 assembly 代码贡献，只构造归并后的实例，未选不构造
→ admit：全部实例 admit 后 worker 才 claim，再挂 provider（admitted/workers-ready）
→ initialize：注入 lifecycle.initInfos，经同一结算屏障确认（initialized）
→ start：注入 lifecycle.startInfos + lifecycle.ready 状态等待（started/running）
→ 无场景则保持交互直到 stop；有场景则执行 scenario 后走同一关闭路径自动退出
```

初始化与启动是两次独立注入：`lifecycle.initInfos` 携带 Owner 应接受的业务初始事实，`lifecycle.startInfos` 触发业务就绪；物理端口、目标绑定和 Adapter 属于构造装配（`params/bindings/dependencies`），不塞进 Info。`runs/demo` 的 startInfos 即 `SubmitOrder → topology/orders`。

## 停止顺序

`run.sh stop` 读活动快照（`.generated/runtime/config-snapshot.json`），不读运行中被改写的 live config；`stopRun` 校验 `runId` 一致，重复停止直接返回成功：

```text
request-stop → stop-business（注入 lifecycle.stopInfos + shutdown drain 结算）
→ evict（unmountRunSlice：密封投递、等 handler/Effect 结算、evict + dispose、释放租约）
→ kernel-shutdown（节点、pending、租约、Effect 全部归零才允许 shutdown，否则拒绝）
→ 关闭前端宿主与后端控制面 → finalize（写 close-result.json，删除 token/lock/control.json）
```

清理失败保留锁、凭证与诊断（`stop-failed` + `lastError`），允许下一次 stop 重试；原始业务错误与清理错误分别保留，场景报告的失败退出码不被清理成功覆盖。`supervisor.sh` 的 `close_run` 顺序为：前端门禁 `gate` → `stop-business` → `stop-sources` → `evict` → `kernel-shutdown` → 前端 `close` → 后端 `close` → `finalize`。

## generation 破坏性断代

Node 热替换与 evict 是刻意的因果断代：`replace` 等待旧 Node 到达单飞间隙，随后丢弃旧 mailbox backlog、使旧 worker 租约失效，并用新实例声明的初始 State 干净启动。旧 State 不自动继承或迁移，旧 Info 不跨 generation 重放，新版本失败也不自动回滚；这些丢失与不回滚语义是有意设计，不是待补缺陷。

## 资源边界

业务结算与资源销毁分开：`stop-business` 发生在有效的 change 结算中，节点 `dispose` 只终结本地生命周期与释放资源。异步 `evict` 先密封投递，等当前 handler 结束后丢弃 backlog，再等待清理；清理错误汇总返回，不能吞掉。`kernelShutdown` 在关闭前核对 kernel pid 所有权；`finalizeRun` 核对 lock 的 `runId` 所有权后才释放锁。强制杀进程不经过此协议。
