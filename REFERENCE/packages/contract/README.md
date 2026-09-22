---
type: API Reference
title: 机器契约与 26 项 daemon 操作
description: 从 JSON Lines 报文、全部操作、错误边界到 Golden Frames 与契约变更验收的自包含参考。
status: stable
tags: [contract, operations, errors, golden-frames, json-lines, public-api]
---

# 机器契约与 26 项 daemon 操作 (`packages/contract`)

本页是跨语言客户端的开发入口。读完即可构造请求、选择 operation、解释响应并验证实现；`operations.json`、`errors.json`、`version.json` 与 `golden-frames/*.json` 是机器可读公开入口。

## 1. 帧格式与连接边界

daemon 使用 UTF-8 JSON Lines，一行一个请求与响应。协议版本是数值 `1`，不是字符串 `"1.0"`：

```json
{"version":1,"id":1,"token":"<当前 run 的随机 token>","op":"health"}
```

成功响应：

```json
{"id":1,"ok":true,"result":{"closed":false,"pid":1234,"nodes":0,"pending":0,"leases":0,"effectLeases":0,"effects":0}}
```

失败响应：

```json
{"id":1,"ok":false,"error":"unsupported protocol version"}
```

约束来自 `version.json`：单帧最多 1 MiB；token 至少 16 字节并由当前 run 生成；只连接 loopback 地址；分析事实最多 5000 个实体、20000 条边、256 KiB；分析响应最多 512 KiB。凭据不得写入源码、文档示例或 run 配置。

## 2. 26 项操作总表

`operations.json` 是字段级机器契约。下表给出开发时需要的语义；required/optional/result 的精确列表以该文件为准。

### 2.1 进程与节点生命周期

| op | 输入 | result | 规则 |
| :--- | :--- | :--- | :--- |
| `shutdown` | 无 | `shutdown` | 仅在无未结算 Effect 时关闭规则空间；关闭后只接受 `health/shutdown` |
| `health` | 无 | `closed,pid,nodes,pending,leases,effectLeases,effects` | 无副作用探活 |
| `admit` | `nodeId,initialState`; 可选 `analysisFacts,effectCapabilities` | `generation` | 新节点 generation 从内核结果开始 |
| `evict` | `nodeId` | `evicted` | 丢弃 backlog、释放节点租约、清除事实 |
| `replace` | `nodeId,initialState`; 可选 `analysisFacts,effectCapabilities` | `generation` | 破坏性断代，不继承 State/backlog |

### 2.2 Worker、提交与状态

| op | 输入 | result | 规则 |
| :--- | :--- | :--- | :--- |
| `claim` | `nodeIds` | 当前连接的 `nodeIds` | 一条连接独占认领；全部节点须已准入 |
| `release` | `nodeIds` | 释放后剩余 `nodeIds` | 活跃 change 未结算时拒绝 |
| `inject` | `targetNodeId,info,submissionId` | `duplicate,feedback` | 同 submission 重放必须内容一致 |
| `poll` | 可选 `waitMs` | `{change,state}` 或 `null` | 先 claim；同连接一次只允许一个活跃 change |
| `commit` | `changeId`; 可选 `operations,error` | `results,version,settled` | write/patch/send 按数组顺序原子结算 |
| `cancel` | `submissionId` | `cancelled` | 丢弃该 submission 未出队工作 |
| `projection` | 无 | `nodes,submissions,pending` | UI/消费端业务事实来源 |
| `analysisFacts` | 无 | `nodes` | 读取当前已准入节点的便携事实 |
| `setErrorTarget` | `nodeId` | `nodeId` | 目标必须已准入；Node 失败作为 `@error/NodeFailed` 路由 |
| `intervene` | `nodeId,patch,expectedGeneration,expectedVersion` | `nodeId,generation,version,state` | 单飞间隙、双前置条件控制面修改 |

`commit.operations` 只允许三种形状：

```json
[
  {"op":"write","key":"count","value":1},
  {"op":"patchState","patch":{"status":"done"}},
  {"op":"send","targetNodeId":"consumer","info":{"type":"CountChanged","count":1}}
]
```

### 2.3 分析与 Agent 控制面

| op | 输入 | result |
| :--- | :--- | :--- |
| `setAnalysisContext` | `frontendLinks,frontendServiceLinks` | `analysisRevision` |
| `analyze` | `request` | 对应 Rust analysis DTO |
| `agentInspect` | 可选 `after,limit` | `projection,pending,drops,activeChanges,leases,effects,submissions,events` |
| `agentInject` | `actor,reason,submissionId,targetNodeId,info` | `duplicate,feedback` |
| `agentInterveneState` | `actor,reason,nodeId,patch,expectedGeneration,expectedVersion` | `nodeId,generation,version,state` |

Agent 写操作必须提供非空 actor 与 reason，以便进入审计事件环。分析 operation 的请求/响应字典见 [Rust 分析引擎](../rust/analysis/README.md)。

### 2.4 Effect 委派

| op | 输入 | result | 调用方 |
| :--- | :--- | :--- | :--- |
| `claimEffects` | `adapterIds` | 当前认领的 `adapterIds` | provider |
| `releaseEffects` | `adapterIds` | 释放后剩余 `adapterIds` | provider |
| `pollEffect` | 可选 `waitMs` | Effect DTO 或 `null` | provider |
| `requestEffect` | `changeId,adapterId,request` | `effectId` | 持有活跃 change 的 worker |
| `awaitEffect` | `effectId`; 可选 `waitMs` | `{ok,value}` 或 `null` | Effect 所属 worker |
| `completeEffect` | `effectId,ok`; 成功给 `observation`，失败给 `error` | `effectId,completed` | 认领该 adapter 的 provider |

Node 必须在 admit/replace 时声明 `effectCapabilities`；未授权 adapter 或无 provider 的请求会被拒绝。provider 退出时必须调用 `releaseEffects`，不得用节点租约的 `release` 代替。

## 3. 客户端公开入口

不要在业务代码里手拼 transport。公开入口保持语言惯用形式：

```ts
import { connectKernelDaemon } from '@graphframework/sdk/agent';
```

```python
from graphframework_sdk.agent import KernelDaemonClient
```

两种 client 都以本页 operation 名与 DTO 字段为准。新增语言实现应把 transport 封装在本语言的 agent 能力面，并通过 Golden Frames 验证。

## 4. 错误与拒绝

`errors.json` 分三类：

- `daemonRejections`：版本/token、分析事实尺寸、响应尺寸、乐观并发与 submission 幂等冲突。
- `kernelErrors`：`DuplicateEntity / UnknownEntity / StaleGeneration / AlreadyBound / Busy`。
- `beginErrors`：`Busy / Sealed / Empty`，表示 change 当前不能开始，不等同于业务失败。

调用方不得依赖未登记的完整错误文案做业务分支；优先按 operation 语义与稳定错误类别处理。

## 5. Golden Frames 与开发流程

Golden frame 的 `requests` 使用 `{op,args}` 便于跨语言重放；发送时客户端负责把 `args` 展开到顶层，并补 `version/id/token`。`$poll.change.changeId` 等字符串是对前序响应的引用占位符，不是原样发送的值。

修改契约的最小闭环：

1. 先改 `operations.json` / `errors.json` / `version.json` 或 golden frame；不要先在某个 SDK 私自增加字段。
2. 同步 Rust daemon 权威实现与 JavaScript、Python client。
3. 每种语言只从其 agent 能力面导出 client，不暴露传输实现路径。
4. 运行纯契约测试；涉及 daemon 行为时再运行 Rust daemon/golden tests。
5. 同步本 README，保证示例可直接形成合法帧。

```bash
PYTHONPATH=packages/sdk/python/src python -m pytest packages/sdk/python/tests/test_mirror.py
cargo test --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-daemon
npm --prefix packages/sdk/javascript run typecheck
npm --prefix packages/desktop run typecheck
```

完成标准：`operations.json` 覆盖 daemon 的每个公开 op；各语言 client 有同语义方法；README 的帧可被 daemon 接受；Golden Frames 可由至少一个跨语言客户端重放。
