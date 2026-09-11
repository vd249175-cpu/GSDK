---
type: guide
---

# Client 与 Element SDK

## 1. 前端权限

业务事实只从 `ApplicationSnapshotStore` 读取；业务写操作只通过 `ApplicationClient`。选择、Markdown 草稿和工作区布局属于 `ClientState`。

```tsx
const nodes = useAppState((state) => state.project.nodes)
const selectedId = useSelectedNodeId()
const application = useApplicationClient()

await application.project.patchNode({
  id: selectedId!,
  patch: { title: '新标题' },
})
```

禁止直接修改 `ApplicationState`、调用 Node.change 或在 renderer 构造 Kernel。

扩展命令使用 `application.graph.injectRootInfo` 时，目标与 Info 类型必须由其后端插件通过 `rendererRoots` 显式公开并通过参数校验。内部提交、落盘和完成观察不能从前端注入。

## 2. Hooks

| Hook | 用途 |
| :--- | :--- |
| `useAppState(selector)` | 订阅只读业务投影（通过 selector 获取最小稳定切片） |
| `useApplicationClient()` | 获取强类型应用命令客户端 |
| `useApplicationRevision()` | 订阅当前 ApplicationSnapshot 版本号，用于确认写操作已被投影接纳 |
| `useShellClient()` | 获取宿主外壳客户端 |
| `useClientState(selector)` | 订阅纯 UI 临时状态 |
| `useWorkbenchContext(token, binding)` | 订阅并读写工作台上下文 Token |
| `useElementState(runtime, id, binding)` | Element 自有、可按作用域绑定的状态 |
| `useNodeState(nodeId)` | 订阅指定 Node 的已投影 State |

selector 应返回最小稳定切片，避免订阅整个 ApplicationState。

## 3. ApplicationClient 契约机制

SDK 微内核与客户端机制本身不预设具体业务命令。应用宿主通过泛型参数向 `defineClientHooks` 注入其强类型客户端 `AppClient`。

`useApplicationClient()` 返回该客户端实例，前端通过其方法向后端发起业务命令（或将命令转换为注入根 Info）。

写操作如需确认生效，可使用返回的 revision 版本号：该版本号表示命令结算后已接纳的应用投影版本，配合 `useApplicationRevision()` 释放本地编辑态草稿。

## 4. 因果命令与图外服务

- 业务状态变迁通过注入根 Info 推进，由图内核保证因果与版本一致性。
- 操作系统级桌面服务（如窗口控制、本地对话框等）由宿主服务提供。
- 两者可统一经 ApplicationClient 暴露，但图外服务不会被伪装成 Node/Info/State。

## 5. Element

业务 Element 位于 `plugins/<plugin-id>/elements/<element-id>/`，通过 `import.meta.glob` 静态进入 Vite bundle 并由 `@graphvideo/workbench` 加载。每个 Element 目录通常包含：

```text
element.json       manifest
element.ts         defineElement 注册入口
*Panel.tsx         React 面板
*.test.ts(x)       行为测试
```

Element 可以注册面板、命令、事件和自身状态，但不能承载项目打开、GraphHost 等启动期基础服务。

## 6. 样式

组件只消费工作台语义 Token，并验证深浅及自定义主题。不要在组件 CSS/TSX 中新增硬编码颜色。
