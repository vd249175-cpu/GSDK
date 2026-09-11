---
type: guide
---

# Plugin SDK 与装卸边界

## 目录与入口

```text
plugins/<plugin-id>/
  graphvideo.plugin.json
  backend.ts                         可选，返回普通 Node 的扁平列表
  elements/<element-id>/
    element.json
    element.ts
  workspaces/<workspace-id>/workspace.json
sdk/
  backend/ client/ contract/ tokens/ ui/ testing/ analysis/
  type-tests/                        随 tsc 执行，不属于运行时
```

主进程的 `createStudioNodes` 从 `app/src/plugins/backend-catalog.ts` 装配插件节点；唯一 `StudioRuntime` 负责执行。renderer 只加载 Element 和工作区，不持有 Kernel。

开发期 `@graphvideo/sdk/analysis` 提供 `findAnalysisNodeChain(view, nodeIds, maxPaths?, maxDepth?)` 和 `findCausalChain(index, addresses, options?)`，按输入顺序检查每一相邻段。结果包含 `waypoints/segments/connected/failedSegmentIndexes`，失败段保留 `reversePaths`；段序号从 0 开始。既有两点 `findAnalysisNodePaths/findCausalPaths` 继续可用。`selectInducedSubgraph` 额外返回 `boundaryIn/boundaryOut/rootInfos/entryPoints/exitPoints`，实体成员不包含外部 Owner。以上 API 只使用本次分析的派生事实，不用于证明某次 submission 的执行顺序，不进入 renderer 生产依赖。

各路径结果的 `diagnostics` 包含 `status`（found/depth-limited/unreachable）、`shortestDistance`、路径 `truncated` 与 `frontier`；失败段的 `reverseDiagnostics` 给出反向证据，未执行反查时为 null。`maxPaths` 必须是正安全整数，`maxDepth` 必须是非负安全整数；不存在的端点报错。Node 端点只展开为本 Node 的 change/State，不引入成员捷径。开发期实例描述通过 `inspectNodeObjects(nodes)` 获取，`AnalysisInstanceDescriptor` 类型来自分析 SDK；后端 Node 基类不承载反射或展示字段。

## 后端公开命令与信任边界

所有插件采用相同的 `BackendPlugin.rendererRoots` 准入机制，不区分内置与第三方。省略该字段表示不允许前端直接注入；插件间图内 `ctx.send` 不受这张入口权限表影响。每项声明必须指向本插件实际创建的 Node，且提供无副作用的 payload 校验函数。例如：

```ts
import { defineBackendPlugin, Node, type Info, type DomainChangeContext } from '@graphvideo/backend-sdk'

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

前端可通过 `application.graph.injectRootInfo('example-node', { type: 'ExampleEditRequestedInfo', text: 'hello' })` 请求变迁。只公开用户意图，不能把内部完成通知、落盘观察或直接物理调用声明为用户入口。不要以类型存在于协议文件为授权依据。`rendererRoots` 是权限声明，不声明 Node 间关系；UI 联动表由各插件在自有 `analysis/` 维护并聚合（过渡期中央桶见 `app/src/application/frontend-links.ts`）。

`StudioRuntime.request` 校验公开命令；`runtime.inject` 是可信 main/test 的内部入口。前端取消只作用于前端创建的在途提交，不能通过猜测 submission ID 取消主进程生命周期操作。在途任务执行期间，互斥操作（如项目切换、快照恢复等）应由业务宿主判断并在忙碌时合理拒绝或排队，等待任务完成或取消结算后再试。本地持久化目录不支持根目录以下的 symlink/junction/硬链接。

插件安装意味着信任代码。后端插件与主进程拥有同一进程权限，前端插件共享 renderer，Manifest 和入口校验都不是逐插件恶意代码沙箱。只安装可信来源；需要运行不可信插件时不能依赖这里的权限声明提供进程隔离。

## 安装与卸载

```bash
npm run plugin -- verify <directory>
npm run plugin -- install <directory>
npm run plugin -- uninstall <plugin-id>
npm run build
```

CLI 修改源码插件目录，卸载目录移动到 `.plugin-trash`，不是立即撤销运行中的节点。插件模块通过 Vite 静态进入 bundle；新增模块、后端修改和后端卸载需要重建并重启应用。

运行中的组件刷新通过 `DesktopElementSource` 比对 `ElementCatalog`。前端插件移除由 `PluginRuntimeManager → ElementLoader.unload` 等待 Runtime/定义清理，注销面板、命令、服务、事件和状态定义，释放插件私有 Context，并由目录快照移除工作区。相同版本可以重新注册。

`register` 或 Runtime `create` 中取得资源后应立即登记 `onDispose`。即使后续注册/构造抛错，已登记资源仍会清理；清理按登记的逆序执行，一项失败会记录错误但不跳过其余项。失败的热更新保留旧版本。同步 Runtime 构造失败启动的异步清理由 manager 跟踪，替换失败、移除和整体 dispose 会等待这些清理完成。

如果刷新检测到含 backend 的插件增删或版本变化，会保留当前前端装配并显示“重建并重启”错误，不将新前端与旧 main Runtime 混用。`PluginRuntimeManager` 只负责 renderer 生命周期，不提供运行中卸载任意后端 Node 的接口。

Context 的普通 clear 操作重置值并保留订阅；最终插件卸载使用 dispose，释放旧 cell，重装可使用新版本默认值。共享 `workbench/*` Token 不属于插件私有命名空间。

## 验收

前端测试应从目录刷新入口验证移除，组件生命周期测试验证异步清理、命令失效和同版本重装。后端测试使用 `@graphvideo/sdk/testing`，Runtime dispose 表达关闭，不表达单插件热卸载。

`npx tsc --noEmit` 包含 `sdk/type-tests/client.ts`（通用工厂断言）与 `sdk/type-tests/studio-binding.ts`（Studio 绑定断言）的精确类型断言；仅把断言放到 `.test.ts` 中不会被当前 tsc 配置检查。
