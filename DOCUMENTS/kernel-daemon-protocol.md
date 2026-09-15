---
type: reference
---

# 常驻 Rust 图宿主协议

`graphvideo-kernel-daemon` 是业务无关的独立进程。它直接复用 `crates/kernel`，持有 Node 注册表、mailbox、submission、权威 JSON State、State 版本和便携分析事实。它不包含 Studio、Electron、项目、媒体或任何业务 Info 名称，也不执行业务 `change`。

当前阶段提供可测试的常驻宿主和语言无关执行边界；Studio 生产装配仍运行在 Electron 内的 `NativeRuleSpace`，尚未切换到 daemon。

## 启动

daemon 只监听 loopback TCP。启动者必须通过环境变量提供至少 16 字节的随机凭证：

```powershell
$env:GRAPHVIDEO_DAEMON_TOKEN = '<random-secret-at-least-16-bytes>'
cargo run -p graphvideo-kernel-daemon
```

`GRAPHVIDEO_DAEMON_BIND` 默认为 `127.0.0.1:0`。daemon 在 stdout 输出唯一一行 ready DTO，此后日志只写 stderr：

```json
{"version":1,"address":"127.0.0.1:52143","pid":1234}
```

JS 宿主可使用：

```ts
import { connectKernelDaemon } from '@graphvideo/backend-sdk'

const client = await connectKernelDaemon({ address, token })
```

其他语言只需实现下述 UTF-8 JSON Lines 协议，不依赖 JS SDK。

## 通用请求

每个请求与响应各占一行，单帧最大 1 MiB。请求必须携带协议版本、连接内请求 ID 和 token：

```json
{"version":1,"id":1,"token":"...","op":"health"}
{"id":1,"ok":true,"result":{"pid":1234,"nodes":0,"pending":0}}
```

同一连接允许多个请求在途，客户端按 `id` 关联响应。请求错误返回 `ok:false`，不会终止 daemon。

## Node 与 State

装配 Node 时只提交语言无关初始 State 和可选分析事实：

```json
{"version":1,"id":2,"token":"...","op":"admit","nodeId":"counter","initialState":{"count":0},"analysisFacts":{"version":1,"nodeId":"counter","entities":[],"edges":[]}}
```

`evict` 删除 Node 和 State；`replace` 只在单飞间隙替换 generation，并使用新的初始 State。`projection` 返回当前所有 Node 的 State、version、generation 以及 submission 状态。`analysisFacts` 返回 daemon 保存的不透明便携事实，调度热路径不解析它们。

可信 Agent 的 State 干预必须携带预期版本：

```json
{"version":1,"id":3,"token":"...","op":"intervene","nodeId":"counter","patch":{"count":5},"expectedGeneration":0,"expectedVersion":0}
```

版本不匹配时整个请求失败，State 不变。

## Info、change 与批量提交

外部根 Info 使用调用方生成的稳定 `submissionId`：

```json
{"version":1,"id":4,"token":"...","op":"inject","targetNodeId":"counter","info":{"type":"IncrementInfo"},"submissionId":"submission/1"}
```

相同 ID、目标和 Info 的重复注入返回原投递反馈，不再次入队；同一 ID 携带不同内容会被拒绝。

任何语言的 Node worker 使用 `poll` 取得一条 change 和该 Owner 的只读 State 快照。执行完成后，把所有写入和 send 作为一个批次提交：

```json
{"version":1,"id":5,"token":"...","op":"commit","changeId":1,"operations":[
  {"op":"write","key":"count","value":1},
  {"op":"send","targetNodeId":"observer","info":{"type":"CountChangedInfo","count":1}}
]}
```

daemon 先完整校验操作，再在同一临界区依次执行并结算 change。这样一次普通 change 只有 `poll + commit` 两次协议往返；State 读操作由 worker 在快照上完成，不逐字段跨进程调用。操作顺序有意义，State version 每次 `write` 或 `patchState` 增加一次。

worker 可在 `commit` 中传 `error`；连接在持有 change 时断开也会产生同等错误。daemon 将错误作为 `@error/NodeFailed` Info 发送到通过 `setErrorTarget` 配置的通用错误节点，然后正常结算原 change，避免单飞永久占用。

## 当前边界

- daemon 退出后尚不能从磁盘恢复 State、mailbox 和 submission；恢复日志属于下一阶段。
- `poll` 当前从整个规则空间领取下一条 change。生产多语言 worker 装配需要增加 Node 租约和定向领取，防止一个 worker 取得不属于它的 Node。
- EffectAdapter 仍未进入 daemon 协议。下一阶段会让执行节点通过带能力的 Effect 端点调用物理宿主，业务含义继续留在内核之外。
- daemon 不负责启动 Electron。未来由图内业务节点决定桌面生命周期，由物理适配器执行进程和窗口动作。
