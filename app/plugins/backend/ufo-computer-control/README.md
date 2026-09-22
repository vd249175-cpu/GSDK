---
type: Developer Guide
title: UFO Computer Control Backend Plugin
description: GraphFramework 的 Microsoft UFO 执行/观察桥、公开入口、Info 契约与验证方式。
status: stable
tags: [plugin, ufo, computer-control, effect-adapter, windows]
---

# UFO Computer Control Backend Plugin

本插件是 GraphFramework 与 `packages/ufo` 上游 Git submodule 之间的唯一业务集成面。插件根入口导出三类 Node、`createUfoComputerControl`、`createUfoComputerControlGraph`、两个 adapter ID 和 `createUfoComputerBridge`；`./bridge` 子路径只导出 bridge factory。

装配时向 graph factory 注入：

- `ufoComputerExecution`：ID `ufo/computer-execution`，只执行物理动作；
- `ufoComputerObservation`：ID `ufo/computer-observation`，只读取窗口、控件、截图和 UI tree。

默认实例 `computer` 的 Node ID 为 `computer/session`、`computer/execution`、`computer/observation`。业务请求只发给 session：

```js
{
  type: 'ControlComputerInfo',
  requestId: 'focus-1',
  action: {
    command: 'focus_window',
    window: { titleContains: 'Notepad' },
  },
  observation: { mode: 'selected-window', includeControls: true },
}
```

纯巡检使用 `InspectComputerInfo`。执行完成后 execution Node 先回传 receipt，session 再请求 observation Node 验证物理事实。所有错误转换为 `ComputerControlFailedInfo`，不会让异常穿透规则空间。

```bash
npm --prefix packages/desktop test -- app/plugins/backend/ufo-computer-control/tests/backend.test.mjs --silent
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
```

真机 UFO 交互只能由一个 Agent 独占桌面并通过命名 run 启动。本插件的日常开发与并行验证使用测试中的 mock adapters，不拉起 worker 或操作桌面。
