---
type: reference
---

# SDK 心智模型：给插件开发者

本文只描述已存在的包与命令。`kernel` 执行语义见 `mental-model.md`；插件装卸见 `plugin-sdk-guide.md`。

## 1. 包与依赖方向

```text
插件 frontend ──→ @graphvideo/client ──→ @graphvideo/workbench
插件 backend  ──→ @graphvideo/sdk/plugin + @graphvideo/sdk/node ──→ @graphvideo/sdk/protocol
插件两端      ──→ 本插件内聚模块（contract/、frontend/、backend/）
宿主          ──→ SDK + 插件贡献（动态装配，不静态依赖业务插件）
```

七个镜像能力面（JS/Python 一一对应）：`protocol/node/effect/plugin/analysis/agent/testing`。
前端专属（无 Python 镜像）：`packages/frontend/{client,workbench,context,theme,ui}`。

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
| `@graphvideo/client` 等前端包 | 投影订阅、hooks、Workbench、Token、UI | 业务 State |

`@graphvideo/sdk/agent` 提供 `connectKernelDaemon` 连接本 run 独占的 Rust 图宿主；`@graphvideo/sdk/node` 的 `admitDaemonNodes` + `runDaemonNodeWorker`（先 admit 全部实例再 claim 再 poll）装配真实 Node 切片；`@graphvideo/sdk/effect` 的 `runDaemonEffectProvider` 认领 Adapter 并执行物理 Effect。`packages/tooling/run` 在此之上提供 assembly（精确到实例，未选不构造）、mount（init/start 经同一结算屏障）、scenario（同运行输入/断言/报告）与 lifecycle（对称启停记录）。其他语言实现相同 DTO 协议即可；daemon 不依赖 JS 业务代码，也不解释 adapter 的业务含义。镜像语义与完整交付验收见 [SDK 与插件分发验收契约](./distribution-contract.md)。

各包独立安装构建（`packages/desktop`、`packages/sdk/javascript`、`packages/frontend/*` 持各自 `package.json`；根目录无 npm 清单和 node_modules）。`app` 只保存 application.json 与插件。桌面源码构建显式消费 SDK 源码；支持 TypeScript 的 Node 宿主可通过 `graphvideo-source` 条件使用源码出口，默认出口使用 dist 发布产物。Rust/N-API 使用 `cargo build --manifest-path packages/rust/Cargo.toml -p graphvideo-kernel-node && node packages/rust/scripts/stage-native.mjs` 构建。

Studio 桌面窗口由图内 `host-el`、`sink-electron-window`、`src-electron-window` 三个节点管理。Electron `ready`、窗口控制 IPC 和系统窗口关闭事件只作为根 Info 输入；物理 BrowserWindow 操作由执行节点的 `electronWindowAdapter` 完成。headless daemon 运行使用实例自带的 in-memory 端口达到同样的 OPENED/CLOSED 因果，不触碰 Electron IPC；生产 run 中 Electron 只做前端宿主，不再持有第二份权威 State。

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
import { createServicesContext, defineClientHooks } from '@graphvideo/client';

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
物理动作执行（写文件/调API/提交任务） → ExecutionWorldNode（插件 backend/nodes，Adapter 在 effects/ 或宿主接入）
物理事实观察（文件监听/状态轮询/事件回调） → ObservationWorldNode（插件 backend/nodes，Adapter 在 effects/ 或宿主接入）
纯计算/格式化 → 普通函数（插件内聚模块或 domain）
UI 读模型 → 投影派生 selector（插件 frontend）
UI 写入口 → 命令适配 → 根 Info（插件 frontend/application）
面板/工作区 → Element（插件 elements/、workspaces/）
临时交互态 → ClientState/ElementState
诊断视角 → 消费方 analysis/ 与只读查询（不参与调度热路径）
```

拿不准时回答归属三问：唯一 Owner 是谁、生命周期何时结束、跨 change 的事实放哪——说不清就不写。

## 5. 本地验证环

```bash
npm --prefix packages/sdk/javascript run typecheck   # SDK 类型
npm --prefix packages/sdk/javascript test -- <目标> --silent
cargo build --manifest-path packages/rust/Cargo.toml -p graphvideo-kernel-node && node packages/rust/scripts/stage-native.mjs  # 动原生绑定后跑（cargo 构建 + 摆放 .node）
node packages/rust/scripts/stage-backend-native.mjs     # 复制到 SDK dist/native，供构建产物消费
npm --prefix packages/desktop run verify                # 检查已有原生绑定并构建应用
npm --prefix packages/desktop run diagnose -- validate   # 改 Node/Info/State/投影/联动后必跑
npm --prefix packages/desktop run diagnose -- node <nodeId>  # 单实体切片，先看局部不看全图
npm --prefix packages/desktop run build    # 动生产装配/Electron 后跑
```

`packages/sdk/javascript/tests/determinism-source.test.ts` 检查 SDK Node 底座的依赖和分析/展示边界，不是全部业务插件的 I/O 扫描器。业务纯领域 Node 的零 I/O 要由插件源码检查及对应测试共同保证。

## 6. 调试入口

- 单 Node 行为：`@graphvideo/sdk/testing` 的 `createTestRuntime` 挂载最小 Node 集合，fake Adapter 覆盖成功/失败/延迟/取消；构造期不做 I/O。
- 因果断点：沿 `Info → change → State → send/effect → Projection` 用 trace 切片定位，不猜。
- 前端不同步：查 `entry → 根 Info → Owner State → 读模型 → consumer` 链，核对 revision。
- 细则见 `kernel-sdk-guide.md` §4–§7（错误即 Info、根提交、投影与原生规则空间）；定位步骤见 [Node 实例因果调试指南](./debug-guide.md)。
