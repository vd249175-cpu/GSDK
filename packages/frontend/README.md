---
type: Developer Guide
title: Frontend Packages
description: GraphFramework 前端基础包的职责、公开入口与最小验证命令。
status: stable
tags: [frontend, packages, public-api, workbench]
---

# Frontend Packages

这里包含零业务语义的前端底座。业务 UI 应通过插件 Element/Workspace 扩展，不直接写入这些包。

| 包 | 根公开入口 | 职责 |
| :--- | :--- | :--- |
| `@graphframework/workbench` | `workbench/src/index.ts` | Dock、registries、Element/Workspace runtime、context 与基础 UI |
| `@graphframework/client` | `client/index.ts` | 应用绑定的 services context 与 React hooks 工厂 |
| `@graphframework/context` | `context/index.ts` | 跨面板共享的 context tokens |
| `@graphframework/ui` | `ui/index.ts` | 通用 Panel、Property、EmptyState、Chip 等组件 |
| `@graphframework/theme` | `theme/index.css` | 全局主题与语义 CSS tokens |

消费者只从包根导入。仅 `@graphframework/workbench/styles/*` 与 `@graphframework/theme/styles/*` 是明确支持的样式子路径。新增公开成员时，从所属包根入口导出并更新入口契约测试。

前端只消费宿主已解码的 Projection。Element 本地状态只承载交互临时态，不复制 Node 业务 State；外部动作通过注入的 application/shell client 发出。

完整开发示例、插件目录约定、hooks 绑定和主题 token 见 [`REFERENCE/packages/frontend/README.md`](../../REFERENCE/packages/frontend/README.md)。

## 验证

```bash
npm --prefix packages/desktop test -- packages/frontend/workbench/src/public-entrypoints.test.ts --silent
npm --prefix packages/desktop run check:renderer-boundary
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
```
