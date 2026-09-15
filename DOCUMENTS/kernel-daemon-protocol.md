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

客户端按 `id` 关联响应；daemon 在每条连接上按接收顺序处理请求。长轮询 worker 应使用独立连接，控制面请求使用另一条连接。请求错误返回 `ok:false`，不会终止 daemon。

## Node 与 State

装配 Node 时只提交语言无关初始 State 和可选分析事实：

```json
{"version":1,"id":2,"token":"...","op":"admit","nodeId":"counter","initialState":{"count":0},"analysisFacts":{"version":1,"nodeId":"counter","entities":[],"edges":[]},"effectCapabilities":[]}
```

`evict` 删除 Node 和 State；`replace` 只在单飞间隙替换 generation，丢弃旧 backlog、释放旧租约，并使用新的初始 State。它不会继承或迁移旧 State、保留跨代消息、无缝切换 worker，也不会在新版本失败时自动回滚。这些破坏性断代语义是刻意设计，不是协议缺失：内核不判断不同版本的 State schema、Info 契约或物理 Effect 是否兼容。

Git 拉取、目录发现、编译器与依赖定位、自动安装/构建、进程启动和文件监听均属于可选外层宿主。daemon 只接受已经启动并通过 DTO 协议连接的 worker；业务需要恢复数据时，应以显式 Info 建模。

`projection` 返回当前所有 Node 的 State、version、generation 以及 submission 状态。`analysisFacts` 返回 daemon 保存的不透明便携事实，调度热路径不解析它们。事实在改变 Node 之前校验：`admit`/`replace` 要求 `analysisFacts.version == 1`、`nodeId` 与目标一致、实体/边在 5000/20000 上限内且单快照不超过 256 KiB；非法事实直接拒绝，不留下半装配 Node。`replace` 只使用新版本提交的事实，旧事实、旧 State、旧 backlog 与旧租约同时消失，不自动回滚。

语言无关的分析上下文与查询由 Rust 统一计算：

```json
{"version":1,"id":9,"token":"...","op":"setAnalysisContext","frontendLinks":[],"frontendServiceLinks":[]}
{"version":1,"id":10,"token":"...","op":"analyze","request":{"op":"view","foldDepth":2}}
```

`analyze` 的 `request` 与统一便携查询 DTO 同构（`index/facts/validate/entity/expand/path/select/view/health/reach/centrality/communities/granularCommunities/compareCommunities`）。缺省 `folds` 时使用覆盖全部 Node 的单层 `world` 根组；对象键按字节序编码。daemon 在短锁内克隆不可变快照，释放调度锁后执行分析；`admit/replace/evict`、上下文变化与新增 State key 增加 `analysisRevision`，普通 State 值变化不失效；单次折叠（64 组/5000 叶）与响应（512 KiB）超限返回协议错误，不影响 daemon。

Agent 控制面复用同一套 Rust 原语，观测与干预都经过 DTO：

```json
{"version":1,"id":11,"token":"...","op":"agentInspect","after":0,"limit":100}
{"version":1,"id":12,"token":"...","op":"agentInject","actor":"agent/codex","reason":"probe","submissionId":"agent/1","targetNodeId":"owner","info":{"type":"ProbeInfo"}}
{"version":1,"id":13,"token":"...","op":"agentInterveneState","actor":"agent/codex","reason":"repair","nodeId":"owner","patch":{"count":2},"expectedGeneration":0,"expectedVersion":1}
```

`agentInspect` 返回 Projection（含 `analysisRevision`）、pending Info、drops、active changes、Node/Effect 租约、pending Effects、submission 状态与因果事件页（内存上限 1000 条，默认 100 条、最大 1000 条，`nextCursor` + `truncated` 语义）。`agentInject` 仍经正常 mailbox/submission 执行并保持重试幂等；`agentInterveneState` 仅支持 Patch，在单飞编辑间隙原子提交并记录前后版本。既有 `inject/intervene/admit/evict/replace/cancel` 保持兼容。控制面只走 loopback + token，不暴露给 renderer。

动态事件与一致性快照是验收红线：执行热路径只更新轻量 revision 与事件，不解析事实、不运行分析。事件覆盖 mailbox、change、submission、drop、Effect 与干预全周期（`root_injected/agent_injected/info_sent/change_started/change_settled/change_failed/delivery_dropped/effect_requested/effect_completed/state_intervened/node_admitted/node_replaced/node_evicted/submission_cancelled/analysis_context_updated`），全部进入同一个 1000 条有界环。分析按请求在单次临界区克隆事实、上下文和 State 字段名，随后释放调度锁再计算；Agent 观测则在一次临界区读取完整 State 与运行队列。同一分析快照绑定一个 revision，绝不混合两个 revision。缓存只用于加速：未命中按需重建并按 `(analysisRevision, request)` 回填，revision 不匹配时不写入缓存；`foldDepth/folds` 每次查询动态传入。

可信 Agent 的 State 干预必须携带预期版本（兼容 `intervene` 与新 `agentInterveneState`，后者另需 `actor`/`reason` 并记录审计事件）：

```json
{"version":1,"id":3,"token":"...","op":"intervene","nodeId":"counter","patch":{"count":5},"expectedGeneration":0,"expectedVersion":0}
```

版本不匹配时整个请求失败，State 不变。干预仅支持 Patch，不支持整对象替换。

## Info、change 与批量提交

外部根 Info 使用调用方生成的稳定 `submissionId`：

```json
{"version":1,"id":4,"token":"...","op":"inject","targetNodeId":"counter","info":{"type":"IncrementInfo"},"submissionId":"submission/1"}
```

相同 ID、目标和 Info 的重复注入返回原投递反馈，不再次入队；同一 ID 携带不同内容会被拒绝。

Node worker 必须先通过 `claim` 独占它实现的 Node；租约绑定当前连接和 Node generation，连接断开、Node 替换或移除都会释放租约。其他 worker 不能领取这些 Node 的 change：

```json
{"version":1,"id":5,"token":"...","op":"claim","nodeIds":["counter"]}
```

任何语言的 worker 随后使用 `poll` 定向取得一条 change 和该 Owner 的只读 State 快照。`waitMs` 可请求最长 30 秒的有界长轮询；新 Info 入队时 daemon 会立即唤醒等待者，空闲时不产生高频请求。执行完成后，把所有写入和 send 作为一个批次提交：

```json
{"version":1,"id":6,"token":"...","op":"commit","changeId":1,"operations":[
  {"op":"write","key":"count","value":1},
  {"op":"send","targetNodeId":"observer","info":{"type":"CountChangedInfo","count":1}}
]}
```

daemon 先完整校验操作，再在同一临界区依次执行并结算 change。这样一次普通 change 只有 `poll + commit` 两次协议往返；State 读操作由 worker 在快照上完成，不逐字段跨进程调用。操作顺序有意义，State version 每次 `write` 或 `patchState` 增加一次。

worker 可在 `commit` 中传 `error`；连接在持有 change 时断开也会产生同等错误。daemon 将错误作为 `@error/NodeFailed` Info 发送到通过 `setErrorTarget` 配置的通用错误节点，然后正常结算原 change，避免单飞永久占用。

JS worker 可用 `runDaemonNodeWorker` 把本地 handler 映射到同一协议。它从 State 快照提供本地 `read/write/patchState/send` Context，并自动批量 commit。该 helper 是一种语言适配器；Python、Rust 或其他语言实现相同帧即可，不需要 JS 参与执行。

## EffectAdapter 能力

需要物理 I/O 的执行 Node 在 `admit` 时声明允许使用的通用 `effectCapabilities`。物理宿主通过独立连接调用 `claimEffects` 独占一个或多个 adapter ID，再以 `pollEffect` 领取不透明请求，并用 `completeEffect` 返回 Observation 或错误。Node change 使用 `requestEffect` 和 `awaitEffect` 等待结果：

```json
{"version":1,"id":7,"token":"...","op":"requestEffect","changeId":1,"adapterId":"vendor/device-v1","request":{"command":"..."}}
{"version":1,"id":8,"token":"...","op":"completeEffect","effectId":1,"ok":true,"observation":{"status":"done"}}
```

daemon 只校验 Node 是否持有该 adapter ID 的能力、provider 是否在线以及 effect 的连接所有权；它不解释 adapter 名称、request 或 Observation。provider 断开时，已领取但未完成的 effect 会重新排队；Node worker 断开时，其未完成 effect 会被取消，并按 change 断线错误结算。

JS 物理宿主可用 `runDaemonEffectProvider` 适配现有 EffectAdapter。Effect 往返只出现在执行物理 I/O 的 change 中；纯领域 change 仍保持 `poll + commit` 两次往返。

## 当前边界

- daemon 退出后尚不能从磁盘恢复 State、mailbox 和 submission；恢复日志属于下一阶段。
- 当前一个 worker 连接同时只持有一条 active change；横向并行通过多个 worker 连接实现，同一 Node 仍保持 single-flight。
- Effect provider 当前使用进程存活期的连接租约；尚未加入 effect 幂等键和 daemon 重启后的物理操作恢复。
- daemon 不负责启动 Electron。未来由图内业务节点决定桌面生命周期，由物理适配器执行进程和窗口动作。
