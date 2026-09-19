---
type: Playbook
title: Node 实例因果调试指南
description: 沿 Info → change → State → send/effect → Projection 精确定位因果断点的标准排障流程。
status: stable
tags: [debugging, troubleshooting, causal-breakpoints, diagnostics]
---

# Node 实例因果调试指南

## 1. 从最小事实开始

默认沿以下方向找第一个与预期不同的事实：

```text
renderer 固定命令
  → rendererRoots 授权的根 Info@Target
  → Node.change
  → State write / Info send / EffectAdapter
  → downstream change
  → GraphProjection / EncodedValue
  → renderer DTO
```

不要先打印或阅读整个仓库。先确定目标 Node ID、State Owner、Info 类型和物理边界，再查询一个实体及其一层上下游。静态实例分析证明“源码中存在这条关系”；submission、Projection 和 Adapter 断言证明“本次运行确实经过这里”。两类证据不能互相替代。

## 2. 地址格式

```text
node:<nodeId>
change:<nodeId>::<InfoType>
info:<InfoType>@<targetNodeId>
state:<nodeId>::<field>
entry:<applicationMethod>
ui:<projectionPath>
```

Info 用“类型 + 目标 Node”精确寻址。只有查询命令明确允许时才省略前缀。

## 3. 当前诊断命令

以下 diagnose 命令分析 `hello-counter` 示例，入口是 `app/plugins/hello-counter/scripts/diagnose.mjs`；它只构造该插件 Node 实例并读取方法描述，不创建 Runtime、不加载原生模块。检查运行中的 Studio 图时，使用下一节的 Agent analyze 通道：

```bash
npm --prefix packages/desktop run diagnose -- validate
npm --prefix packages/desktop run diagnose -- node example.counter
npm --prefix packages/desktop run diagnose -- change example.counter::IncrementInfo
npm --prefix packages/desktop run diagnose -- info IncrementInfo@example.counter
npm --prefix packages/desktop run diagnose -- state example.counter::count
npm --prefix packages/desktop run diagnose -- expand state:example.counter::count
npm --prefix packages/desktop run diagnose -- path entry:counter.increment ui:counter.count
npm --prefix packages/desktop run diagnose -- select example.counter
npm --prefix packages/desktop run diagnose -- frontend
npm --prefix packages/desktop run diagnose -- health
npm --prefix packages/desktop run diagnose -- reach example.counter
```

`path` 按参数顺序逐段执行有向最短路径查询。每段独立返回 `found`、`depth-limited` 或 `unreachable`；前向失败时会附带反向证据与 frontier。Node 地址只在路径端点展开为其 change/State，contains/owns 不是因果捷径。

`select` 返回选中 Node 的内部实体与边，并分别列出 `boundaryIn`、`boundaryOut`、无 SEND/INJECT 来源的 `rootInfos`、`entryPoints` 和 `exitPoints`。边界外的 Owner 不会被塞进子图成员。

`health` 与 `reach` 先通过 `buildAllNodesView` 把当前实例索引投影为 Node 级视角；前者报告静态耦合与孤立点，后者报告指定 Node 的上下游距离。它们不代表运行频率。

## 4. 运行时检查

静态关系存在但行为仍异常时，沿当前 submission 检查：

- `submissionState(id)` 是否仍在 pending、已经 completed/cancelled，或记录 failure；
- `pendingTotal()` 与 `queuedDepths()` 是否持续不归零；
- `drops()` 是否出现 Missing、Sealed、Evicted 或 Cancelled；
- Projection 的 `revision`、Node `version/status` 是否推进；
- EffectAdapter 是否收到预期 Request、Clock 与 AbortSignal；
- 替换后旧 generation 的 ctx 是否已失效，新实例是否从自身初始 State 启动。

原生规则空间的 Agent 控制面提供最近 1000 条因果事件及游标查询，但不是持久 trace 历史。需要证明某次执行顺序时，使用最小测试记录 submission、State、Info、Effect 和 Projection，不要把静态可达性当作动态 Trace。当前生产装配的静态索引可通过 `NativeRuleSpace.analyze` 或 `node packages/desktop/scripts/agent-control.mjs analyze request.json` 查询，`foldDepth` 控制折叠视角分辨率。

## 5. 高频断点

| 现象 | 优先检查 |
| :--- | :--- |
| renderer 点击无响应 | preload 白名单、IPC handler、`assertRendererRoot`、根 Info 目标 |
| Node 收不到消息 | `Info.type`、目标 Node ID、drop reason、目标是否处于替换密封 |
| State 改了但界面不变 | Owner write、Projection revision、ValueCodec decode、renderer DTO |
| submission 不完成 | pending delivery、运行中的 change、未结算 Effect、取消信号 |
| 取消无效 | 是否取消正确 submission、Adapter 是否响应 signal；既有写入不会回滚 |
| 热替换后出现旧数据 | 新实例初态、显式恢复 Info、旧 ctx/generation 是否仍被使用 |
| `Invalid runtime capability` | 是否同时加载了两份 `@graphframework/sdk/node` 运行模块 |
| `unresolved-info-type` | 把完整 Info 的字面量 `type` 放回发送点，不用不透明构造器隐藏 |
| topology 缺少静态路由 | 查看 snapshot 的 `unresolvedInfoTypes` / `unresolvedSendTargets`；不要用正则或名字猜边 |

## 6. 固化为最小测试

单 Node 或局部链路优先使用 `@graphframework/sdk/testing`：

```ts
const runtime = createTestRuntime({ nodes: [new CounterNode()] })
await runtime.inject('example.counter', { type: 'IncrementInfo' })
await runtime.waitForQuiescence()
expect(runtime.getState('example.counter')).toEqual({ count: 1 })
await runtime.dispose()
```

测试使用真实 Node，只替换构造注入的 Adapter；断言最终 State、边界 Info、Effect Observation、Projection 和 submission 结算，不依赖私有方法调用顺序。

```bash
npm --prefix packages/desktop test -- <target-test> --silent
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
npm --prefix packages/desktop run diagnose -- validate
```
