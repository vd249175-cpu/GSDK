---
type: guide
---

# 通用桌面宿主

本包提供 Electron 启动器、通用图宿主、插件加载、renderer 入口及源码构建。应用配置位于 `../../app/application.json`；Studio 业务代码位于 `../../app/plugins/graphvideo.studio/`。

在仓库根目录执行：

```bash
npm install --prefix packages/desktop
npm --prefix packages/desktop run build
npm --prefix packages/desktop run start
```

外部应用通过 `GRAPHVIDEO_APPLICATION` 指定 application.json 的绝对路径。插件 path 相对于配置所在目录解析。desktop.host 和 desktop.renderer 分别引用启用插件的业务接入入口。

- `host/` 提供启动器、通用 Rust NativeRuleSpace 图宿主、插件加载、窗口 Adapter、目录清单和可信 Agent 控制面。
- `renderer/` 提供通用 HTML 和主题入口，业务应用和 Element 来自启用插件。
- `build/` 从 SDK 源码构建宿主和插件，从统一 frontend 包构建工作台。
- `scripts/` 提供边界检查和控制客户端。

达芬奇主题由 `@graphvideo/theme` 提供；布局、停靠、现有浮动窗口和上下文机制由 `@graphvideo/workbench` 提供。插件自行实现面板内容。

```bash
npm --prefix packages/desktop run typecheck
npm --prefix packages/desktop test -- <目标文件> --silent
npm --prefix packages/desktop run check:renderer-boundary
npm --prefix packages/desktop run verify:native-load
node packages/tooling/refactor/check-layout.mjs
```

原生绑定先按 [Kernel SDK 指南](../../DOCUMENTS/kernel-sdk-guide.md) 构建和暂存。窗口生命周期继续由图内 Info 推进。
