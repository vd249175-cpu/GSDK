---
type: Developer Guide
title: 前端 Packages 开发入口
description: 五个前端包的统一导出、客户端 hooks 工厂、Element/Workspace 扩展、Projection 边界与主题规范。
status: stable
tags: [frontend, workbench, client, context, ui, theme, public-api, projection]
---

# 前端 Packages 开发入口 (`packages/frontend`)

本页是前端底座开发起点。读完即可选包、从公开入口导入、绑定客户端 hooks、注册 Element/Workspace 并完成验证。前端只消费解码后的 Projection，不拥有第二份业务 State。

## 1. 五个包与唯一入口

| 包 | 公开入口 | 职责 |
| :--- | :--- | :--- |
| `@graphframework/workbench` | `workbench/src/index.ts` | Dock、Workspace、Element runtime、registries、context、commands、基础 UI |
| `@graphframework/client` | `client/index.ts` | `createServicesContext`、`defineClientHooks`、`useStateSelector` 与 workbench 类型重导出 |
| `@graphframework/context` | `context/index.ts` | 跨面板、零业务语义的共享 context tokens |
| `@graphframework/ui` | `ui/index.ts` | 可复用 Panel/Property/EmptyState/Chip/NodeCard/Settings 组件 |
| `@graphframework/theme` | `theme/index.css` | 全局主题、字体、颜色、终端和语义 CSS tokens |

每个包只有一个根公开入口，由各自 `package.json#exports` 声明。消费者不得深层导入源码；唯一例外是被明确导出的 `@graphframework/workbench/styles/*` 与 `@graphframework/theme/styles/*` 样式子路径。

## 2. Projection 与 State 边界

- 后端 Projection 的 State 是 `EncodedValue`；宿主/client adapter 必须先用协议 `valueCodec.decode`，再向 React 暴露只读 snapshot。
- `useNodeState` 只是对已解码 AppState 的 selector，不会自行 fetch、轮询或连接 Kernel。
- Element State 与 Workbench Context 只保存交互临时态，不得复制 Node 业务事实。
- UI 命令通过注入的 application/shell client 发出 Info 或宿主请求；组件不得直接调用 Node、filesystem 或 Electron。

## 3. 正确生成客户端 hooks

`@graphframework/client` 不直接导出一组全局业务 hooks。每个应用先绑定自己的 services 与 State 形状，再重导出生成结果：

```tsx
import {
  createServicesContext,
  defineClientHooks,
  type ClientHookServices,
} from '@graphframework/client'

interface AppState {
  projectId: string | null
  nodes: Record<string, { state: unknown }>
}

interface ClientState { activeTab: string }
interface ApplicationClient { send(targetNodeId: string, info: { type: string }): Promise<void> }
interface ShellClient { openExternal(url: string): Promise<void> }

type Services = ClientHookServices<AppState, ClientState, ApplicationClient, ShellClient>

export const { ServiceProvider, useServices } = createServicesContext<Services>()
export const {
  useAppState,
  useApplicationClient,
  useApplicationRevision,
  useShellClient,
  useClientState,
  useWorkbenchContext,
  useElementState,
  useNodeState,
} = defineClientHooks(useServices, {
  selectProjectId: (state) => state.projectId,
  readPluginStates: (state) => state.nodes,
})
```

组件只从应用绑定层导入 hooks：

```tsx
import { useNodeState } from './client-hooks'

export function CounterValue() {
  const count = useNodeState<{ count: number }, number>('counter', (state) => state.count)
  return <output>{count ?? 0}</output>
}
```

生成的完整 hook 集就是上例解构的八项；源码中不存在无需绑定即可从 `@graphframework/client` 直接导入的 `useNodeState`。

## 4. 插件 UI：Elements 与 Workspaces

前端 v2 插件通过 Manifest 声明包内 frontend/host 入口及 Element/Workspace ID，不使用 `rendererRoots` 或固定 `mountId`：

```json
{
  "id": "example.dashboard",
  "name": "Dashboard",
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "frontend",
  "contributes": {
    "host": "desktop/main.mjs",
    "frontend": "index.tsx",
    "elements": ["example.counter"],
    "workspaces": ["monitoring"]
  }
}
```

约定目录：

```text
elements/example.counter/
├── element.json     # id/name/apiVersion:1/entry:"element.ts"
└── element.ts       # defineElement({ register(context) { ... } })

workspaces/monitoring/
└── workspace.json   # id/name/order/layout；area 或 split 树
```

Element 通过 registration context 注册 panels、extensions、commands、states、services、events 与 runtime factory。Workspace 只声明布局，不持有业务事实。拆卸时由 `onDispose`/runtime manager 对称清理全部 owned registrations。

## 5. 主题与 UI

入口通常只需：

```ts
import '@graphframework/theme'
import '@graphframework/workbench/styles/index.css'
```

业务 CSS 使用当前语义 token，不使用已不存在的 `--gv-*` 名称或裸颜色：

- surface：`--surface-app/panel/raised/input/hover/selected/canvas/document/header/backdrop`
- content：`--content-primary/secondary/tertiary/on-action`
- border：`--border-default/strong/subtle`
- accent：`--accent-primary/strong/soft`
- state：`--state-success-*`、`--state-warning-*`、`--state-danger-*`
- typography：`--font-family-*`、`--font-size-*`、`--font-weight-*`、`--line-height-*`
- geometry：`--radius-none/xs/sm`、`--shadow-floating`

新增颜色先进入 theme 语义层；组件不能直接依赖 `--palette-source-*` 原始迁移 token。

## 6. 开发与验证

1. 先选择唯一拥有职责的包；业务面板放插件 Element，不进入 workbench/ui。
2. 新公开成员从包根 index 导出并补测试；新增包才建立新的 package export。
3. 用 registries/runtime 的最小单测验证注册、绑定和 dispose，不启动 Electron。
4. 运行：

```bash
npm --prefix packages/desktop test -- packages/frontend/workbench/src/public-entrypoints.test.ts --silent
npm --prefix packages/desktop run check:renderer-boundary
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
```

完成标准：五个包根入口可解析；示例只使用公开 API；业务事实只来自解码 Projection；Element/Workspace 可对称卸载；CSS 只使用现行语义 token；renderer 不导入 Node/Effect/宿主模块。
