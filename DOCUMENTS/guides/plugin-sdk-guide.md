---
type: Developer Guide
title: Plugin SDK 开发指南与装配边界
description: 插件 Manifest 规范、装载器、生命周期、rendererRoots 与运行时热替换边界。
status: stable
tags: [sdk, plugin, manifest, hot-reload, lifecycle]
---

# Plugin SDK 当前边界

本文是插件装载、权限、Agent 控制面和运行时替换的高级参考。普通业务插件不需要先理解这些实现细节；请先按[业务开发入门](application-development.md)完成 Node、测试与 run 装配，遇到 Manifest、宿主信任或替换问题时再回到本文。

## 目录与入口

```text
app/plugins/<plugin-directory>/
  graphframework.plugin.json
  backend.mjs|index.mjs              普通 Node 与实例工厂（命名 run 只调用配置命中的工厂）
  frontend/ desktop/ resources/      插件自己的业务接入、界面与资源
  elements/ workspaces/              可选工作台贡献
packages/sdk/javascript/src/
  protocol/ node/ effect/ plugin/ analysis/ agent/ testing/
packages/frontend/
  client/ workbench/ context/ theme/ ui/
```

当前 `app/application.json` 显式列出启用插件及目录（当前默认应用 `graphframework-demo` 装配 `demo.topology` 后端与前端），`packages/desktop/host/plugin-loader.mjs` 加载各插件后端构建入口，通用图宿主调用 `plugin.createNodes({ dependencies })` 并挂载到唯一 `NativeRuleSpace`。命名 run 的生产装配走 `packages/tooling/run/src/assembly.mjs`：`run.config.json` 选择代码 assembly 模块，模块贡献命中的 `nodeFactories/graphFactories`、构造参数、目标绑定和前端实例，未选实例不构造。renderer 通过构建期虚拟模块加载启用插件的 Element；不加载后端模块，也不持有 Kernel。当前没有 ZIP 安装器或自动目录监听发布流程。

## Run 代码装配贡献

可分享能力以纯装配模块表达跨插件组合，而不是把业务关系留在接收方私有的 `run.config.json` 中：

```js
export default {
  id: 'example.reconciliation',
  contribute(run) {
    run.backendPlugin({ id: 'example.finance', path: './backend' })
    run.frontendPlugin({ id: 'example.finance', path: './frontend' })
    run.node({ id: 'finance/reconciliation', plugin: 'example.finance', factory: 'createReconciliationNode', bindings: { orders: 'core.orders' } })
    run.frontend({ id: 'finance-ui', plugin: 'example.finance', graph: 'finance' })
    run.requireNode('core.orders')
  },
}
```

模块相对路径以 assembly 文件所在目录解析。贡献代码只描述构造与绑定，不启动进程、不读写业务 State，也不增加运行时 Edge/Flow；Node 内协作仍只通过实际 `ctx.send`。同一定义重复贡献会去重，定义不同的同 ID 贡献在取得运行锁前失败并报告双方定义。`requireNode` 不复制或构造依赖，只验证完整装配确实提供该 Node。

正式插件与同事自行开发的自动化插件使用完全相同的运行接口；“核心”只表示发布与维护归属，不是另一种内核插件类型。发布包的不可修改边界、独立插件扩展方式、OKF 说明和折叠建议见[插件发布与协作契约](../contracts/plugin-collaboration-contract.md)。

开发期 `@graphframework/sdk/analysis` 提供 `findCausalChain(index, addresses, options?)`，按输入顺序检查每一相邻段。结果包含 `waypoints/segments/connected/failedSegmentIndexes`，失败段保留 `reversePaths`；段序号从 0 开始。两点查询使用 `findCausalPaths`；Node 链使用 `node:<id>` 地址，端点展开为本 Node 的 change/State，不引入成员捷径。生产和跨语言客户端使用 Rust 统一 `path` operation，传入 `addresses`。`selectInducedSubgraph` 额外返回 `boundaryIn/boundaryOut/rootInfos/entryPoints/exitPoints`，实体成员不包含外部 Owner。以上 API 不用于证明某次 submission 的执行顺序，不进入 renderer 生产依赖。

各路径结果的 `diagnostics` 包含 `status`（found/depth-limited/unreachable）、`shortestDistance`、路径 `truncated` 与 `frontier`；失败段的 `reverseDiagnostics` 给出反向证据，未执行反查时为 null。`maxPaths` 必须是正安全整数，`maxDepth` 必须是非负安全整数；不存在的端点报错。Node 端点只展开为本 Node 的 change/State，不引入成员捷径。开发期实例描述通过 `inspectNodeObjects(nodes)` 获取，`AnalysisInstanceDescriptor` 类型来自分析 SDK；后端 Node 基类不承载反射或展示字段。

## 后端公开命令与信任边界

所有插件采用相同的 `BackendPlugin.rendererRoots` 准入机制，不区分内置与第三方。省略该字段表示不允许前端直接注入；插件间图内 `ctx.send` 不受这张入口权限表影响。每项声明必须指向本插件实际创建的 Node，且提供无副作用的 payload 校验函数。例如：

```ts
import { defineBackendPlugin } from '@graphframework/sdk/plugin'
import { Node, type Info, type DomainChangeContext } from '@graphframework/sdk/node'

class ExampleNode extends Node<{ text: string }> {
  constructor() { super('example-node', 'Example', { text: '' }) }
  protected change(info: Info, ctx: DomainChangeContext<{ text: string }>) {
    if (info.type === 'ExampleEditRequestedInfo' && typeof info.text === 'string') {
      ctx.write('text', info.text)
    }
  }
}

export default defineBackendPlugin({
  id: 'example.tools',
  createNodes: () => [new ExampleNode()],
  rendererRoots: [{
    targetNodeId: 'example-node',
    infoType: 'ExampleEditRequestedInfo',
    validate: (info) => typeof info.text === 'string',
  }],
})
```

主进程先用 `assertRendererRoot` 校验 `{ targetNodeId, info }`，再向规则空间注入根 Info。只公开用户意图，不能把内部完成通知、落盘观察或直接物理调用声明为用户入口。不要以类型存在于协议文件为授权依据；`rendererRoots` 是权限声明，不声明 Node 间关系。

renderer 只能调用 preload 暴露的固定命令，不能提交任意 Node ID、Info 或 submission ID。可信 main/test 可以直接调用规则空间 API。取消只作用于对应 submission；已经写入的 State 和已经完成的外部事实不回滚。

可信主进程的 `NativeGraphHost` 还提供 Agent 控制面：`agentInspect({ after, limit })` 返回 Projection、解码后的各 Node State、当前待投递 Info、drop ledger 与近期因果事件；`agentInject(nodeId, info, { actor, reason })` 绕过 `rendererRoots` 向任意已装配 Node 发起普通根 submission，并返回 `enqueued/dropped` 反馈；`agentInterveneState(nodeId, patch, { actor, reason, expectedGeneration, expectedVersion })` 在目标单飞间隙修改 State。版本或代际变化会拒绝干预，排队的 Info 不丢弃。干预独立记录为 `state_intervened`，不伪装成 Node 的 change。该控制面不经 renderer IPC 或遥测 HTTP 服务公开；独立的 Agent 本机控制服务只监听 `127.0.0.1`，每次启动生成随机令牌，拒绝带浏览器 Origin 的请求。

应用运行时，可信 Agent 可从仓库根目录执行 `node packages/desktop/scripts/agent-control.mjs inspect`。`inject` 与 `patch` 命令再提供一个 JSON 请求文件路径，例如 `node packages/desktop/scripts/agent-control.mjs inject request.json`；请求字段分别为 `{ "targetNodeId": "...", "info": { "type": "..." }, "reason": "..." }` 和 `{ "nodeId": "...", "patch": { ... }, "expectedGeneration": 0, "expectedVersion": 1, "reason": "..." }`。客户端从当前用户目录的 `.graphframework/agent-control.json` 读取端口和令牌，应用关闭后删除该文件。因果事件只在宿主内存中保留最近 1000 条，不能当作持久审计库。

`node packages/desktop/scripts/agent-control.mjs analyze request.json` 可查询当前已装配 Node 的静态因果分析。例如请求 `{ "op": "view", "foldDepth": 0 }` 把默认根组合为一个折叠 Node，`foldDepth: 1` 展开为基础 Node；也可传入 `folds: { "version": 1, "root": "world", "groups": { "world": { "children": ["group-a"] }, "group-a": { "children": ["node-a", "node-b"] } } }` 指定更深的折叠层级。`health`、`reach`、`centrality` 和 `communities` 使用同一视角参数；`path`、`select`、`entity`、`expand`、`validate`、`granularCommunities` 和 `compareCommunities` 也由同一只读分析入口提供。完整语义见 [实例因果分析](../diagnostics/causal-analysis.md)。

源码内部的 `mountProcessNode` 可挂载一个 JSON Lines 进程 Node，并在 `ready` 帧提供 `PortableAnalysisSnapshot`；当前公开 SDK index 未导出它，不能按旧示例通过包入口调用。公开跨语言接入使用 daemon 与 node/agent/effect 客户端。两种宿主路径使用同一 Rust 分析实现，`facts` 查询返回便携快照。保留的进程协议与公开边界见 [跨语言 Node 与分析事实协议](../protocols/portable-node-protocol.md)。

生产宿主把已声明的 `rendererRoots` 作为入口事实纳入索引。需要 State→UI 证据时，创建宿主时传入 `analysisFrontendLinks` 与可选 `analysisFrontendServiceLinks`；这些表只表达已存在的应用边界，不影响调度。

插件安装意味着信任代码。后端插件与主进程拥有同一进程权限，前端插件共享 renderer，Manifest 和入口校验都不是逐插件恶意代码沙箱。只安装可信来源；需要运行不可信插件时不能依赖这里的权限声明提供进程隔离。

## Manifest

`graphframework.plugin.json` 由 `parseStudioPluginManifest` 校验：`apiVersion: 1` 为旧形态（`contributes.backend/elements/workspaces`，`app/plugins/demo-topology` 与 `app/plugins/hello-counter` 的遗留目录仍是此形态）；`apiVersion: 2` 按 `kind` 分为后端（`contributes.backend/nodeFactories/graphFactories`）与前端（`contributes.host/frontend/elements/workspaces`）两种形态，`kind` 与 `contributes` 不一致直接拒绝。入口必须是包内相对路径，ID 与版本必须满足校验器约束。Manifest 是描述与校验契约，不会自动安装、加载或隔离代码。

运行中替换后端 Node 使用 `replaceDomainNode`。替换会等待旧实体到达单飞间隙，丢弃旧 backlog，以新实例的初始 State 启动；不会自动迁移 State。插件或 Node 的 `dispose` 在替换、移除和宿主关闭时由规则空间等待清理。

## 验收
后端 Node 优先使用 `@graphframework/sdk/testing` 的 `createTestRuntime` 做确定性测试；原生桥接、热替换和 Electron 加载使用本仓库现有测试与验收命令。命令正本见 [测试分层](testing.md) §验证命令；插件级入口示例：
```bash
npm --prefix packages/desktop test -- app/plugins/hello-counter/backend.test.mjs --silent
npm --prefix packages/desktop test -- app/plugins/backend/hello-counter/tests/native-graph-host.test.mjs --silent
```
