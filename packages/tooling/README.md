---
type: Developer Guide
title: Tooling Packages
description: Run、refactor 与 causal visualizer 工具包的源码入口和验证命令。
status: stable
tags: [tooling, run, refactor, causal-visualizer]
---

# Tooling Packages

本目录包含三个相互独立的工具包：

- `run/`：v2 命名 run 的配置、装配、生命周期、控制面与分发；用户命令只经仓库根 `run.sh`。
- `refactor/`：TypeScript LanguageService 重构、AST import 改写与布局守卫。
- `causal-visualizer/`：Swiss-2D 因果画布及可配置 telemetry client；当前仅作为可构建组件，尚无独立受支持 run。

每个包都在 `package.json#exports["."]` 声明唯一根入口。可复用接口从根入口导入，CLI 只通过各包 `bin` 或仓库根 `run.sh` 调用，不新增 `src/*` 深层依赖。

详细开发指南见 [`REFERENCE/packages/tooling/README.md`](../../REFERENCE/packages/tooling/README.md)。

```bash
npm --prefix packages/tooling/run test
npm --prefix packages/tooling/run run typecheck
npm --prefix packages/tooling/refactor test
npm --prefix packages/tooling/refactor run typecheck
npm --prefix packages/tooling/causal-visualizer test
npm --prefix packages/tooling/causal-visualizer run build
```
