---
type: Developer Guide
title: Client 与 Element SDK 开发指南
description: 前端投影快照解码、客户端 reactive hooks 与 Workbench Element 扩展组件规范。
status: stable
tags: [sdk, client, element, projection, workbench]
---

# Client 与 Element SDK

## 1. 当前边界

`@graphframework/client` 提供与业务类型无关的 React Context、快照订阅和 Workbench Element 绑定机制。业务事实由宿主提供的 `applicationSnapshots` 读取，写操作由宿主注入的 `applicationClient` 承担；选择、草稿和布局等临时事实属于 `clientState`。

禁止直接修改业务投影、调用 `Node.change`，或在 renderer 构造 Kernel。应用客户端若把命令翻译为根 Info，目标与 Info 类型必须由后端插件通过 `rendererRoots` 显式公开，并在主进程用 `assertRendererRoot` 校验。

当前 `app/application.json` 装配 `demo.topology` 后端与前端插件。demo 前端不使用 `@graphframework/client` hooks：`app/plugins/frontend/demo-topology/frontend/app.tsx` 直接调用 `desktop/preload.cjs` 暴露的 `window.demo/window.graph/window.shell` 固定通道，`desktop/main.mjs` 把通道翻译为 run 控制面的 `projection` 读取与 `inject-renderer` 根 Info 注入；主进程 ElementCatalog 只读取各插件贡献清单中的 Element/Workspace（demo 为空）。counter 是独立的测试与诊断插件。

## 2. Context 与 Hooks

宿主先用 `createServicesContext` 绑定自己的服务类型，再用 `defineClientHooks` 绑定 AppState、ClientState、AppClient 与 ShellClient：

```tsx
const { ServiceProvider, useServices } = createServicesContext<MyServices>()

export const {
  useAppState,
  useApplicationClient,
  useApplicationRevision,
  useShellClient,
  useClientState,
  useWorkbenchContext,
  useElementState,
  useNodeState,
} = defineClientHooks<AppState, ClientState, AppClient, ShellClient>(useServices, {
  selectProjectId: (state) => state.projectId,
  readPluginStates: (state) => state.plugins,
})
```

| Hook | 用途 |
| :--- | :--- |
| `useAppState(selector)` | 订阅只读业务投影的最小切片 |
| `useApplicationClient()` | 获取宿主注入的业务命令客户端 |
| `useApplicationRevision()` | 订阅快照源 revision |
| `useShellClient()` | 获取图外宿主服务客户端 |
| `useClientState(selector)` | 订阅纯 UI 临时状态 |
| `useWorkbenchContext(token, binding)` | 订阅和写入工作台 Context |
| `useElementState(runtime, id, binding)` | 订阅和写入 Element 自有状态 |
| `useNodeState(nodeId, selector?)` | 读取已投影的指定 Node State |

`useStateSelector` 基于 `useSyncExternalStore`，默认以浅比较复用 selector 结果。selector 应返回最小稳定切片。

## 3. 命令与图外服务

- 业务变迁由应用客户端转换为经过授权的根 Info。
- 本地窗口控制等宿主服务由宿主客户端提供；demo 把 `shell:close` 转为 run 控制面的 `request-stop`，再由执行侧走完整关闭路径，不直接杀内核。
- 两者可以由同一个前端服务集合暴露，但图外服务不会伪装成 Node、Info 或 State。
- SDK 不规定命令返回值；命令是否返回 revision、何时释放本地草稿，由具体业务客户端契约决定。

## 4. Element

`defineWorkbenchElement` 是 `@graphframework/workbench` 的 `defineElement` 转出。Element 可通过注册上下文贡献面板、命令、事件、服务和自身状态，并在生命周期结束时清理资源。

具体目录结构、发现方式和加载顺序由消费应用决定。`@graphframework/client` 不扫描插件目录，也不负责安装或卸载插件。

## 5. 样式

组件应消费工作台语义 Token，并验证深色、浅色、雪青和石榴裙主题。不要在共享组件中新增与主题绑定的硬编码颜色。
