---
type: Protocol Specification
title: 跨语言 Node 与便携分析事实协议
description: 跨语言 Node 的进程帧、Rust C ABI 接口契约与 PortableAnalysisSnapshot 分析事实格式。
status: stable
tags: [protocol, cross-language, c-abi, node-frames, analysis-snapshot]
---

# 跨语言 Node 与分析事实协议

生产调度仍由 Rust `Kernel` 持有。它同时暴露 Rust API、Node-API 和 `packages/rust/kernel-ffi` 的 C ABI；不同语言宿主可通过相同的调度操作驱动 Node。当前 JS 宿主的 `mountProcessNode(space, options)` 把一个外部进程挂载为一个 Node：进程使用 UTF-8 JSON Lines，宿主把每个 `ctx` 请求交给当前 `NativeChangeContext`，因此 State Owner、单飞、Info 投递反馈、EffectAdapter 权限和错误转 Info 仍遵循同一规则。现有 JS Node 不经过进程桥接。

## 1. 启动与装配

进程启动后向 stdout 输出一行 `ready`，随后只输出协议帧；日志写到 stderr。每个进程拥有一个 Node。宿主收到 `ready` 后注册 Node，进程退出或协议失效时移除该 Node。

```json
{"kind":"ready","version":1,"nodeId":"python.worker","initialState":{"runs":0},"analysisFacts":{"version":1,"nodeId":"python.worker","entities":[{"address":"node:python.worker","kind":"node","id":"python.worker"}],"edges":[]}}
```

`analysisFacts` 必须与 `nodeId` 一致。它是语言无关的 `PortableAnalysisSnapshot`：`entities` 和 `edges` 使用因果索引的标准地址、关系类型与 `confidence`，可附 `location`。每种语言的适配器负责从自己的实际代码或编译产物生成事实；宿主不根据变量名猜测 send。此快照是静态证据，不证明某次运行实际走过该路径。

当前 `mountProcessNode` 实现在 `packages/sdk/javascript/src/node/native-node.ts`，由源码测试直接调用；`@graphframework/sdk/node` 的公开 index 尚未转出它。这是公开接入缺口，不能照旧文档从 plugin 或 node 包导入，也不能把已存在的进程协议说明删掉来隐藏缺口。下面保留内部函数的调用形状；通过公开 SDK 接入任意语言 worker 时，使用 [daemon 协议](kernel-daemon-protocol.md)及 node/agent/effect 能力面。

```text
已有 NativeRuleSpace：space
const worker = await mountProcessNode(space, {
  command: 'python',
  args: ['-u', 'path/to/worker.py'],
  expectedNodeId: 'python.worker',
})
```

## 2. 执行帧

Rust 开始一次单飞 change 后，宿主发送 `{"kind":"change","changeId":1,"info":{"type":"RunInfo"}}`。进程可依次发 `call`，每次等待同一 `changeId/callId` 的 `result`，最后发 `settle` 或 `fail`。`changeId` 是进程协议内的请求号；Rust 因果身份保留在宿主的 `NativeChangeContext` 中。

```json
{"kind":"call","changeId":1,"callId":1,"op":"read","key":"runs"}
{"kind":"result","changeId":1,"callId":1,"ok":true,"value":0}
{"kind":"call","changeId":1,"callId":2,"op":"write","key":"runs","value":1}
{"kind":"call","changeId":1,"callId":3,"op":"send","info":{"type":"DoneInfo"},"targetNodeId":"target"}
{"kind":"settle","changeId":1}
```

可用操作为 `read`、`write`、`patchState`、`send`、`effect`。`send` 的 `result.value` 是即时 `enqueued/dropped` 投递反馈。`effect` 指定 `adapterId` 和 `request`，ready 帧必须声明 `isWorldNode: true`，且宿主必须在 `options.adapters` 注入对应 Adapter。`fail` 携带 `error` 字符串，宿主将异常交给现有错误 Info 机制。协议错误会终止进程桥接。

## 3. 分析与性能

Rust 内核按 Node generation 保存事实，`admit/replace` 前校验 schema、`nodeId` 绑定与尺寸，拒绝旧 generation 写入，替换或移除时清除；调度、send 和 change 结算不读取或解析它。`graphframework-analysis` 是跨语言协议的权威分析计算实现：daemon `analyze`、N-API `analyzeJson` 与 C ABI `gv_analyze` 调用同一个 Rust crate，不复制算法。`NativeRuleSpace.analyze` 已直接使用 N-API；JS 只把已构造实例扫描为便携事实，查询、路径、折叠和指标不再回落到 TS。显式离线消费者仍可使用 `@graphframework/sdk/analysis` 的纯函数。没有便携事实的原始 handler 会被标成 `opaque-handler`，只合成可见 State 字段，不推断 send/read/write。

`NativeRuleSpace.analyze` 首次请求才读取事实、装配索引并运行分析。跨进程 Node 的每次 `ctx` 调用有一次 JSON Lines 往返；该成本只落在使用进程协议的 Node 上。语言运行时需要实现上述小型帧协议及因果事实生成器，不需要重写图分析算法。Rust 调度热路径不检查或解析分析事实。

## 4. 非 JS 宿主

`packages/rust/kernel-ffi/include/graphframework_kernel.h` 是稳定 C ABI 的头文件。`cargo build --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-ffi` 生成当前平台共享库；它提供 `admit/send/inject_root/poll_next/settle_change/cancel`、代次与编辑保留位，以及注册时设置、按需读取分析事实。`gv_analysis_snapshot` 一次性取出所有已登记事实，结果由 `gv_analysis_snapshot_free` 释放；`gv_analyze` 对传入的便携事实执行与 daemon 相同的 Rust 分析，结果由 `gv_analysis_free` 释放。每个宿主用自己的语言执行 change 和保管 Owner State，同一个 Rust `GvKernel` handle 保证 mailbox 与单飞。其它返回字符串由 `gv_string_free` 释放；`gv_poll_next` 返回的 change 必须由 `gv_settle_change` 消费并结算。`gv_change_free` 只释放内存，不结算单飞 change。

仓库包含 [Python ctypes 宿主样例](../../packages/rust/kernel-ffi/examples/ctypes_smoke.py)：Python 直接驱动 Rust 调度器，让两个 Python Node 通过 Info 通信，并读回便携分析事实。它不经过 JS。非 JS 宿主可以直接调用 `gv_analyze`，也可以把 `PortableAnalysisSnapshot` 交给 daemon；C ABI 本身不创建远程 Agent 控制通道，通道与宿主 State 观测由具体应用宿主决定。

独立进程宿主见 [常驻 Rust 图宿主协议](kernel-daemon-protocol.md)。它把权威 JSON State 和版本移入 Rust daemon，通过 generation 绑定的 Node 租约定向分发 change，并把普通 change 压缩为一次 `poll` 和一次批量 `commit`；物理 Effect 由能力绑定的外部 provider 执行，Rust 只转发不透明 DTO。因此它与本页现有 JS `mountProcessNode` 的逐次 `ctx` 往返是两条不同的宿主路径。生产 Studio 尚未迁入 daemon。
