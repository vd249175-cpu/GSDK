---
type: guide
---

# Plugin SDK 当前边界

## 目录与入口

```text
apps/local-app/plugins/<plugin-id>/
  graphvideo.plugin.json
  backend.mjs                        返回普通 Node 的扁平列表
sdk/
  backend/ client/ contract/ tokens/ ui/ testing/ analysis/
  type-tests/                        随 tsc 执行，不属于运行时
```

当前本地应用在 `src-main/main.mjs` 中显式导入插件，调用 `plugin.createNodes({})` 后挂载到唯一 `NativeRuleSpace`。`products/default.json` 记录产品选择，但当前没有动态插件安装器或运行时目录扫描器。renderer 不加载后端模块，也不持有 Kernel。

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

主进程先用 `assertRendererRoot` 校验 `{ targetNodeId, info }`，再向规则空间注入根 Info。只公开用户意图，不能把内部完成通知、落盘观察或直接物理调用声明为用户入口。不要以类型存在于协议文件为授权依据；`rendererRoots` 是权限声明，不声明 Node 间关系。

renderer 只能调用 preload 暴露的固定命令，不能提交任意 Node ID、Info 或 submission ID。可信 main/test 可以直接调用规则空间 API。取消只作用于对应 submission；已经写入的 State 和已经完成的外部事实不回滚。

插件安装意味着信任代码。后端插件与主进程拥有同一进程权限，前端插件共享 renderer，Manifest 和入口校验都不是逐插件恶意代码沙箱。只安装可信来源；需要运行不可信插件时不能依赖这里的权限声明提供进程隔离。

## Manifest

`graphvideo.plugin.json` 由 `parseStudioPluginManifest` 校验，当前字段为 `apiVersion`、`id`、`name`、`version` 和可选 `contributes.backend/elements/workspaces`。入口必须是包内相对路径，ID 与版本必须满足校验器约束。Manifest 是描述与校验契约，不会自动安装、加载或隔离代码。

运行中替换后端 Node 使用 `replaceDomainNode`。替换会等待旧实体到达单飞间隙，丢弃旧 backlog，以新实例的初始 State 启动；不会自动迁移 State。插件或 Node 的 `dispose` 在替换、移除和宿主关闭时由规则空间等待清理。

## 验收

后端 Node 优先使用 `@graphvideo/sdk/testing` 的 `createTestRuntime` 做确定性测试；原生桥接、热替换和 Electron 加载使用本仓库现有测试与验收命令：

```bash
npx vitest run apps/local-app/plugins/hello-counter/backend.test.mjs --silent
npx vitest run apps/local-app/src-main/native-graph-host.test.mjs --silent
npm --prefix apps/local-app run diagnose -- validate
npm run verify:app
```
