---
type: reference
---

# SDK 心智模型：给插件开发者

本文只描述已存在的包与命令。`kernel` 执行语义见 `mental-model.md`；插件装卸见 `plugin-sdk-guide.md`。

## 1. 包与依赖方向

```text
插件 frontend ──→ @graphvideo/sdk/client ──→ @graphvideo/workbench
插件 backend  ──→ @graphvideo/backend-sdk ──→ @graphvideo/kernel
插件两端      ──→ 本插件内聚模块（contract/、frontend/、backend/）
宿主          ──→ SDK + 插件贡献（动态装配，不静态依赖业务插件）

禁止反向：SDK 不导入插件；kernel 不导入任何人；
插件之间只经显式声明的公开契约协作，不导入对方实现。
```

| 包 | 内容 | 不含 |
| --- | --- | --- |
| `@graphvideo/kernel` | Node/WorldNode（ExecutionWorldNode/ObservationWorldNode）、mailbox/change 调度、State 版本、Projection、EffectAdapter 调用边界 | 业务、React、Node.js API |
| `@graphvideo/backend-sdk` | Node/WorldNode（ExecutionWorldNode/ObservationWorldNode）、Info/change/Effect 类型、NodeFactory/GraphFactory、BackendPlugin 契约、rendererRoots 校验、Manifest 定义 | React、业务 Node、业务协议 |
| `@graphvideo/sdk/client` | `createServicesContext`、`defineClientHooks`（四泛型）、`useStateSelector`、Element/Workbench 类型与 `defineWorkbenchElement` | 业务 State、业务 Client、业务 hooks |
| `@graphvideo/workbench` | Dock、工作区、Element 加载/生命周期、面板/命令/事件/状态注册、通用 UI 控件 | 业务面板、业务 Token、Kernel |
| `@graphvideo/sdk/testing` | `createTestRuntime`、`EffectHarness`（经 kernel） | 生产装配 |
| `@graphvideo/sdk/contract` | Manifest 类型与校验（转出 backend-sdk） | 运行时 |
| `@graphvideo/sdk/tokens`、`./ui` | 跨面板联动 Token、通用面板控件 | 业务面板 |

`@graphvideo/sdk/analysis` 是 Node.js 开发期条目（实例因果分析），不进浏览器包。

构建产物：`npm run build:sdk` 生成各包 `dist/`（JS + `.d.ts`）；发布形态以各 `package.json` 的 `exports`/`files`/`peerDependencies` 为准。当前包为 `private`，以 tarball（`npm pack`）交付；`backend-sdk` 无 React 依赖，后端消费者不装 React。一键导出与仓外验收：`npm run export:sdk` 打包四包到 `dist/packages/`，并在仓外临时工程安装 tarball 后 smoke 公开子路径（manifest 校验、测试运行时注数、因果索引校验）。

## 2. 后端心智模型：事实只进 Owner

```ts
import { defineBackendPlugin, Node, type DomainChangeContext, type Info } from '@graphvideo/backend-sdk';

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
import { createServicesContext, defineClientHooks } from '@graphvideo/sdk/client';

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

拿不准时回答归属五问（见 `development-constraints.md` §1）：说不清唯一 Owner 与生命周期就不写。

## 5. 本地验证环

```bash
npm run build:sdk                       # 构建全部 SDK dist
npx tsc --noEmit                        # 类型（含 sdk/type-tests 精确断言）
npx vitest run --project unit <目标> --silent
npm run trace -- validate --json        # 改 Node/Info/State/投影/联动后必跑
npm run trace -- node <nodeId> --json   # 单实体切片，先看局部不看全图
npm run build                           # 动生产装配/Electron 后跑
```

`tools/causal/plugin-boundary.test.ts` 是架构门禁：新增对宿主的反向引用即失败；迁移完成就删清单行，不要加行。

## 6. 调试入口

- 单 Node 行为：`sdk/testing` 的 `createTestRuntime` 挂载最小 Node 集合，fake Adapter 覆盖成功/失败/延迟/取消；构造期不做 I/O。
- 因果断点：沿 `Info → change → State → send/effect → Projection` 用 trace 切片定位，不猜。
- 前端不同步：查 `entry → 根 Info → Owner State → 读模型 → consumer` 链，核对 revision。
- 细则见 `debug-guide.md` 插件调试节。
