---
type: reference
---

# SDK 心智模型：给插件开发者

本文只描述已存在的包与命令。`kernel` 执行语义见 `mental-model.md`；插件装卸见 `plugin-sdk-guide.md`。

## 1. 包与依赖方向

```text
插件 frontend ──→ @graphvideo/packages/frontend/client ──→ @graphvideo/workbench
插件 backend  ──→ @graphvideo/sdk/plugin + @graphvideo/sdk/node ──→ @graphvideo/sdk/protocol
插件两端      ──→ 本插件内聚模块（contract/、frontend/、backend/）
宿主          ──→ SDK + 插件贡献（动态装配，不静态依赖业务插件）
```

七个镜像能力面（JS/Python 一一对应）：`protocol/node/effect/plugin/analysis/agent/testing`。
前端专属（无 Python 镜像）：`packages/frontend/{client,workbench,tokens,ui}`。

禁止反向：SDK 不导入插件；Rust 内核不导入任何人；
插件之间只经显式声明的公开契约协作，不导入对方实现。

| 包 | 内容 | 不含 |
| --- | --- | --- |
| `@graphvideo/sdk/protocol` | Info/State/Projection/错误码等语言无关 DTO | 业务、React、Node.js API |
| `@graphvideo/sdk/node` | Node/WorldNode（ExecutionWorldNode/ObservationWorldNode）、change 上下文、`NativeRuleSpace` 与 Node 挂载桥接、冻结参考规约（KernelRuntime） | 业务、React |
| `@graphvideo/sdk/effect` | EffectAdapter 边界与 daemon provider 适配 | 业务 Node、业务协议 |
| `@graphvideo/sdk/plugin` | BackendPlugin 契约、rendererRoots 校验、Manifest 定义 | React、业务 Node、业务协议 |
| `@graphvideo/sdk/agent` | `KernelDaemonClient`、inspect/analyze/inject/patch 控制面 | 业务逻辑 |
| `@graphvideo/sdk/analysis` | JS 实例扫描与便携事实；权威计算在 Rust `graphvideo-analysis` | 业务、浏览器包 |
| `@graphvideo/sdk/testing` | `createTestRuntime`（快速单节点规约测试）、`EffectHarness` | 生产装配 |
| `@graphvideo/packages/frontend/client` 等前端包 | 投影订阅、hooks、Workbench、Token、UI | 业务 State |

`@graphvideo/sdk/agent` 还提供 `connectKernelDaemon`、`runDaemonNodeWorker` 和 `runDaemonEffectProvider`：前者连接业务无关的独立 Rust 图宿主，后两者分别把 JS change handler 与物理 EffectAdapter 适配为通用租约协议。其他语言直接实现相同 DTO 协议即可；daemon 不依赖 JS 业务代码，也不解释 adapter 的业务含义。

本仓库采用 npm workspace 源码构建（`packages/sdk/javascript`、`packages/frontend/*`、`app`）。TypeScript 类型与大部分 SDK 入口直接指向源码；`npm run build:native` 构建 Rust/N-API 调度内核。本仓库不提供 tarball 导出、发包或仓外脚手架流程。

Studio 桌面窗口由图内 `host-el`、`sink-electron-window`、`src-electron-window` 三个节点管理。Electron `ready`、窗口控制 IPC 和系统窗口关闭事件只作为根 Info 输入；物理 BrowserWindow 操作由执行节点的 `electronWindowAdapter` 完成。关闭全部窗口后，图宿主仍在 Electron 主进程中运行，直到该进程结束。

## 2. 后端心智模型：事实只进 Owner

```ts
import { defineBackendPlugin } from '@graphvideo/sdk/plugin';
import { Node, type DomainChangeContext, type Info } from '@graphvideo/sdk/node';

class CounterNode extends Node<{ count: number }> {
  constructor() { super('example.counter', 'Counter', { count: 0 }); }

  change(info: Info, ctx: DomainChangeContext<{ count: number }>) {
    if (info.type === 'IncrementInfo') ctx.write('count', ctx.read('count') + 1);
  }
}

export default defineBackendPlugin({
  id: 'example.counter',
  rendererRoots: [{
    targetNodeId: 'example.counter',
    infoType: 'IncrementInfo',
    validate: (info) => info.type === 'IncrementInfo',
  }],
  createNodes: () => [new CounterNode()],
});
```

规则（违反即 bug）：

- 每个 State 字段只有一个 Owner Node；只在 `change(ctx)` 内 `read/write`。
- Node 间只 `ctx.send(info, targetNodeId)`；`type` 在发送点静态可见。
- 纯领域 Node 零 I/O；物理副作用严格圈禁于 `WorldNode`。**WorldNode 必须分为执行与观察两类且物理分离**：动作下发用 `ExecutionWorldNode`，事实感知用 `ObservationWorldNode`，物理动作只经构造注入的 `EffectAdapter` 执行。
- `rendererRoots` 只声明用户意图入口；内部 Observation 不公开。
- 纯算法用普通函数，不要为复用造 Node；跨插件复用走公开契约，不搬回 SDK。

## 3. 前端心智模型：绑定一次，到处订阅

SDK 只给机制，业务绑定由插件（或宿主）完成一次：

```ts
import { createServicesContext, defineClientHooks } from '@graphvideo/packages/frontend/client';

const { ServicesContext, ServiceProvider, useServices } =
  createServicesContext<MyServices>(myServices);

export const {
  useAppState, useApplicationClient, useApplicationRevision, useShellClient,
  useClientState, useWorkbenchContext, useElementState, useNodeState,
} = defineClientHooks<MyApp, MyClient, MyAppClient, MyShell>(useServices, {
  selectProjectId: (state) => state.project.id,
  readPluginStates: (state) => state.plugins,
});
```

- `useAppState(selector)`：只读订阅，selector 越小越好；从不写入业务事实。
- `useApplicationClient()`：唯一写入口（发命令→根 Info），不直接调 IPC/Node。
- `useNodeState(nodeId)`：读指定 Node 的已投影 State；跨 Node 复制 State 是 bug，去发 Info。
- Element 经 `defineElement({ register })` 注册面板/命令，在 `onDispose` 清理；`register` 内拿资源先登记清理。
- 选择、草稿、布局是 Element/Client 临时态，不进 Node State。

## 4. 代码放哪：决策树

```text
跨 change 持续的业务事实 → Owner Node State（插件 backend/nodes）
Node 间协作 → ctx.send + Info（type 就近可见）
物理动作执行（写文件/调API/提交任务） → ExecutionWorldNode（插件 backend/effects）
物理事实观察（文件监听/状态轮询/事件回调） → ObservationWorldNode（插件 backend/effects）
纯计算/格式化 → 普通函数（插件内聚模块或 domain）
UI 读模型 → 投影派生 selector（插件 frontend）
UI 写入口 → 命令适配 → 根 Info（插件 frontend/application）
面板/工作区 → Element（插件 elements/、workspaces/）
临时交互态 → ClientState/ElementState
诊断视角 → analysis/（不进生产）
```

拿不准时回答归属三问：唯一 Owner 是谁、生命周期何时结束、跨 change 的事实放哪——说不清就不写。

## 5. 本地验证环

```bash
npx tsc --noEmit                        # 类型
npx vitest run --project unit <目标> --silent
npm run build:native                     # 动原生绑定后跑（cargo 构建 + 摆放 .node）
npm run verify:app                       # 构建 native 并完成本地应用验收
npm --prefix app run diagnose -- validate   # 改 Node/Info/State/投影/联动后必跑
npm --prefix app run diagnose -- node <nodeId>  # 单实体切片，先看局部不看全图
npm --prefix app run build    # 动生产装配/Electron 后跑
```

`packages/sdk/javascript/tests/determinism-source.test.ts` 是架构门禁：业务 Node 触碰 I/O/系统 API 即失败。

## 6. 调试入口

- 单 Node 行为：`@graphvideo/sdk/testing` 的 `createTestRuntime` 挂载最小 Node 集合，fake Adapter 覆盖成功/失败/延迟/取消；构造期不做 I/O。
- 因果断点：沿 `Info → change → State → send/effect → Projection` 用 trace 切片定位，不猜。
- 前端不同步：查 `entry → 根 Info → Owner State → 读模型 → consumer` 链，核对 revision。
- 细则见 `kernel-sdk-guide.md` §4–§7（错误即 Info、根提交、投影与原生规则空间）；定位步骤见 [Node 实例因果调试指南](./debug-guide.md)。
