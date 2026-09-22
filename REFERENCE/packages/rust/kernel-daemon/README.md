---
type: API Reference
title: graphframework-kernel-daemon 接口
description: TCP JSON Lines 宿主、Session/租约、Effect 委派、分析快照与公开 Rust API 的源码对齐参考。
status: stable
tags: [rust, daemon, tcp, json-lines, session, lease, effect, public-api]
---

# `graphframework-kernel-daemon` 接口

开发流程和 crate 选择见 [Rust 开发入口](../README.md)。本页只描述 daemon 的真实物理接口；全部 JSON operation 与字段见 [机器契约](../../contract/README.md)。

## 1. 传输与启动事实

- binary 只监听 loopback TCP，不通过 STDIN 接收请求。
- 每个 TCP 帧是 UTF-8 JSON 后加换行；响应同样一行一个 JSON。
- 必须提供至少 16 字节的 `GRAPHFRAMEWORK_DAEMON_TOKEN`；bind 默认 `127.0.0.1:0`，可由 `GRAPHFRAMEWORK_DAEMON_BIND` 指定，但仍必须是 loopback。
- 进程启动后只在 stdout 输出一次 readiness：`{"version":1,"address":"127.0.0.1:<port>","pid":...}`。这不是请求通道。
- 正式启动由根目录 `run.sh` 管理；不得直接运行 binary 形成旁路宿主。

## 2. Rust library 公开入口

```rust
use graphframework_kernel_daemon::{
    PendingAnalysis, Session, Space, PUBLIC_OPERATIONS,
};
```

| API | 作用 |
| :--- | :--- |
| `Session::new(id)` | 创建一个连接作用域的 Node/Effect 租约容器 |
| `Session::disconnect(&mut space)` | 归还租约、重排未完成 Effect、把在途 change 结算为错误事实 |
| `Space::default()` | 创建拥有 Kernel、JSON State、租约、Effect 与事件环的宿主空间 |
| `Space::handle(session, request, token)` | 同步处理普通 JSON Lines 请求，返回完整响应 envelope |
| `Space::prepare_analyze(...)` | 在调度锁内复制不可变分析快照，供锁外计算 |
| `Space::store_analysis(...)` | 仅在 revision 未变化时写回分析缓存 |
| `Space::is_closed()` | 查询规则空间是否终止 |
| `PUBLIC_OPERATIONS` | 26 个稳定 operation 名；测试与机器契约逐项相等 |

`PendingAnalysis` 只包含 request、facts、context、revision、cached 与响应 id；它不持有锁，也不执行 Node 或 Effect。

## 3. Session 与租约

- `claim/release` 管理 Node worker 租约；一个 Node 同时只属于一个 Session。
- 一个 Session 同时最多持有一个活跃 change；必须 `commit` 后才能再次 `poll` 或释放节点。
- `claimEffects/releaseEffects` 管理 Effect provider 租约，与 Node 租约是两套物理集合。
- worker 断连时，活跃 change 以 `Node worker disconnected` 结算并可路由 `@error/NodeFailed`；节点本身与 mailbox 保留。
- provider 断连时，属于它的 active Effect 回到 queued，等待其他 provider；请求方断连时，它创建的 Effect 被删除。

## 4. State、Effect 与错误边界

daemon 持有每个 Node 的 JSON object State、version、generation 和 `effectCapabilities`。`commit.operations` 只接受：

- `write`：写一个 State key；
- `patchState`：合并一个对象；
- `send`：定向发送一个带静态 `type` 的 Info。

每个 write/patch 各递增一次 version。`intervene/agentInterveneState` 同时校验 expected generation 与 version，只在单飞间隙修改。

Effect 必须满足三项条件：请求发生在当前 Session 的活跃 change 内；Node 已声明 adapter capability；该 adapter 有在线 provider。失败必须通过 `completeEffect(ok:false,error)` 返回，不得让 provider 异常击穿循环。

## 5. 分析与事件环

- admit/replace 在 Node 生效前校验 `analysisFacts` 的尺寸、nodeId 与 schema；失败不会留下半准入节点。
- analyze 在锁内只快照 facts/State keys/context，实际 `graphframework-analysis` 计算在锁外执行。
- 缓存键是 `(analysisRevision, request)`；admit/replace/evict、分析 context 变化或新增 State key 都会递增 revision。
- Agent 事件环最多 1000 条，`agentInspect(after,limit)` 使用单调 cursor 分页；默认 100，最大 1000。

## 6. 验证

```bash
cargo test --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-daemon
PYTHONPATH=packages/sdk/python/src python -m pytest packages/sdk/python/tests/test_mirror.py
```

第一项覆盖 Session、长轮询、Effect、显式 shutdown、Golden Frames 与 operation catalog；第二项覆盖 Python client 的公共方法与机器契约读取。
