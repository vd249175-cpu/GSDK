---
type: guide
---

# 通用桌面宿主

本包提供 Electron 物理端口、前端底座和开发检查。完整 Studio 由根目录命名 run 启动；后端插件位于 `app/plugins/backend/graphvideo.studio`，前端与 Electron 宿主位于 `app/plugins/frontend/graphvideo.studio`。

在仓库根目录执行：

```bash
npm install --prefix packages/desktop
bash ./run.sh start runs/studio/run.config.json
bash ./run.sh status runs/studio/run.config.json
bash ./run.sh stop runs/studio/run.config.json
```

每个 run 的 v2 配置显式选择插件、节点或图工厂、namespace、前端及初始化和启停 Info。相对路径以配置目录为基准。Bash 启动独立 Rust daemon、后端和前端，并将产物、缓存、日志及 Electron 用户数据写入该 run 的 `.generated/`。npm start 拒绝隐式启动。

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

原生绑定先按 [Kernel SDK 指南](../../DOCUMENTS/guides/kernel-sdk-guide.md) 构建和暂存。窗口生命周期继续由图内 Info 推进。
