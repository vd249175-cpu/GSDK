---
type: Reference Manual
title: UFO Computer Control 插件手册
description: example.ufo-computer-control 的公开导出、三节点因果流、Info、action、observation 与 bridge 契约。
status: stable
tags: [plugin, ufo, computer-control, windows, effect-adapter, public-api]
---

# UFO Computer Control 插件手册

插件 ID 为 `example.ufo-computer-control`，源码位于 `app/plugins/backend/ufo-computer-control/`。它是纯后端 v2 插件，没有 renderer roots；UI 或外部调用者不能绕过宿主直接控制桌面。

## 1. 根导出与工厂

插件包根导出：

- `UfoComputerSessionNode`、`UfoComputerExecutionNode`、`UfoComputerObservationNode`
- `createUfoComputerControl(ctx)`：返回 `{session, execution, observation}`
- `createUfoComputerControlGraph(ctx)`：返回三 Node 数组；`describe()` 声明 `localIds: ['session','execution','observation']`
- `UFO_EXECUTION_ADAPTER_ID`：`ufo/computer-execution`
- `UFO_OBSERVATION_ADAPTER_ID`：`ufo/computer-observation`
- `createUfoComputerBridge(options)`；也可从插件 `./bridge` 子路径导入

在 run assembly 中：

```js
run.backendPlugin({
  id: 'example.ufo-computer-control',
  path: '../../app/plugins/backend/ufo-computer-control',
})
run.graph({
  id: 'computer',
  plugin: 'example.ufo-computer-control',
  factory: 'createUfoComputerControlGraph',
})
run.requireNode('computer/session')
```

实例名为 `computer` 时，Node ID 是 `computer/session`、`computer/execution`、`computer/observation`。无实例上下文时才使用 `example.ufo-computer-control/*` 默认 ID。

## 2. 因果闭环

```text
InspectComputerInfo
  session -> ObserveComputerInfo -> observation adapter
          <- ComputerObservedInfo <- observation

ControlComputerInfo
  session -> ExecuteComputerActionInfo -> execution adapter
          <- ComputerActionExecutedInfo <- execution
  session -> ObserveComputerInfo -> observation adapter
          <- ComputerObservedInfo <- observation
```

任一 world node 捕获 adapter 异常并发送 `ComputerControlFailedInfo` 给 session。session 是 State Owner；execution/observation 只维护各自诊断 State，不写 session State。

## 3. 外部 Info

巡检：

```js
{
  type: 'InspectComputerInfo',
  requestId: 'inspect-1',
  observation: {
    mode: 'desktop',
    includeScreenshot: true,
  },
}
```

控制并后置观察：

```js
{
  type: 'ControlComputerInfo',
  requestId: 'focus-1',
  action: {
    command: 'focus_window',
    window: { titleContains: 'Notepad' },
  },
  observation: {
    mode: 'selected-window',
    includeControls: true,
    includeUiTree: false,
  },
}
```

`requestId` 必须非空，`ControlComputerInfo.action` 必须存在。session 不验证每条 UFO command 的参数；worker 是动作 schema 的最终守卫。

## 4. Action 契约

通用形状：

```ts
interface ComputerAction {
  command: string
  window?: { id?: string; handle?: number; name?: string; titleContains?: string }
  controlId?: string
  controlName?: string
  args?: Record<string, unknown>
}
```

worker 当前白名单：

- UI/输入：`click_input`、`click_on_coordinates`、`drag_on_coordinates`、`set_edit_text`、`keyboard_input`、`wheel_mouse_input`、`click`、`double_click`、`keypress`、`move`、`scroll`、`type`
- 窗口：`focus_window`、`maximize_window`、`minimize_window`、`restore_window`、`close_window`

窗口命令通过 `action.window` 定位。其余命令可用顶层 `controlId/controlName` 绑定最近一次 observation 返回的控件，并把命令参数放入 `action.args`。控件 ID 是短期句柄；窗口刷新后失效时必须重新观察，不得长期持久化。

## 5. Observation 契约

```ts
interface ComputerObservationRequest {
  mode?: 'desktop' | 'window' | 'selected-window' | 'after-action'
  window?: { id?: string; handle?: number; name?: string; titleContains?: string }
  includeScreenshot?: boolean
  includeControls?: boolean
  includeUiTree?: boolean
  maxControls?: number       // worker 限制为 1..1000
  settleMs?: number          // worker 限制为 0..5000
}
```

`desktop` 返回顶层窗口并可截全屏；其他三种模式解析目标/已选窗口，可返回窗口截图、控件列表和 UI tree。结果字段为 `mode`、`windows`、`selectedWindow`、`controls`、`screenshotPath`、`uiTree`、`observedAt`。

窗口对象使用 `id/name/title/type/handle/processId/processName/rect/active/minimized/maximized/visible`；控件对象使用 `id/name/type/automationId/className/rect/enabled/visible`。不要使用旧字段 `process`、`control_type` 或 `bounding_box`。

## 6. Session State

session State 包含：`status`、`requestId`、`operation`、`selectedWindow`、`windows`、`controls`、`screenshotPath`、`uiTree`、`actionResult`、`observation`、`completedAt`、`lastError`。`completedAt` 只接受 observation/Info 携带的物理时间；纯领域 Node 不读取系统时钟。

状态只从 Projection 读取。调用方不得把 State 直接写回 session，也不得把 Python UIA 对象放进 Info 或 State。

## 7. Bridge 与宿主注入

```ts
createUfoComputerBridge({
  pythonExecutable,
  ufoDirectory,
  screenshotsDirectory,
  workerScript?,
  spawnProcess?,
  requestTimeoutMs?,
})
```

bridge 返回 `executionAdapter`、`observationAdapter` 与异步 `stop()`。它按需启动一个 JSONL worker，串行化请求，验证 ready handshake，限制超时，在停止时关闭或终止子进程。宿主必须在 run teardown 调用 `stop()`。

`runs/main/host.mjs` 是当前正式装配：从 run 配置解析 UFO submodule、Python 和截图目录，随后把两个 adapters 注入 `computer` 实例。开发 run 应复制这种构造注入方式，不能在 Node 内启动 Python。

## 8. 测试与完成标准

```bash
npm --prefix packages/desktop test -- app/plugins/backend/ufo-computer-control/tests/backend.test.mjs --silent
npm --prefix packages/desktop test -- runs/main/tests/main-assembly.test.mjs --silent
npm --prefix packages/desktop run check:renderer-boundary
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
```

mock 测试必须覆盖巡检、执行后观察、执行失败和根导出；不得在并行测试中操作真机桌面。真机验收必须通过命名 run、获取桌面独占权并由用户明确要求。
