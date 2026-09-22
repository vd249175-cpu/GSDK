---
type: Developer Guide
title: Tooling Packages 开发入口
description: 统一 run、AST 重构工具与 Swiss-2D 因果可视化组件的真实入口、公开导出和验证方式。
status: stable
tags: [tooling, run, refactor, causal-visualizer, public-api]
---

# Tooling Packages 开发入口 (`packages/tooling`)

本页是工具链开发起点。三个子包职责独立，都通过自身 `package.json` 暴露根入口；运行中的应用与内核仍只能由仓库根 `run.sh` 管理。

| 包 | 根入口 | 用途 | 开发验证 |
| :--- | :--- | :--- | :--- |
| `@graphframework/run` | `run/index.mjs` | v2 run 配置、assembly、生命周期组合、控制面、分发 | `npm --prefix packages/tooling/run test` / `typecheck` |
| `@graphframework/refactor` | `refactor/index.mjs` | `rewriteImports` 库接口及三个 CLI | `npm --prefix packages/tooling/refactor test` / `typecheck` |
| `@graphframework/causal-visualizer` | `causal-visualizer/src/index.ts` | Swiss-2D React 画布、可配置 telemetry client 与 DTO 类型 | `npm --prefix packages/tooling/causal-visualizer test` / `build` |

## 1. 选择工具

- 需要启动、停止、校验、检查或打包命名 run：从根目录调用 `bash ./run.sh ...`，见 [run 开发指南](run.md)。
- 需要符号重命名或移动 TypeScript 文件：优先使用 `refactor.mjs` 的 LanguageService 操作；只改模块路径时使用 `rewrite-imports.mjs`。
- 需要开发因果画布或接入一个已有 telemetry transport：使用 visualizer 根导出，见 [causal visualizer 开发指南](causal-visualizer.md)。

## 2. 重构工具

先安装该包依赖：

```bash
npm --prefix packages/tooling/refactor ci
```

从仓库根执行：

```bash
node packages/tooling/refactor/refactor.mjs find-refs <file> <symbol> --project <tsconfig>
node packages/tooling/refactor/refactor.mjs rename <file> <old> <new> --project <tsconfig>
node packages/tooling/refactor/refactor.mjs move <from> <to> --project <tsconfig>
node packages/tooling/refactor/rewrite-imports.mjs <scope> <old-specifier> <new-specifier>
node packages/tooling/refactor/check-layout.mjs
```

`rewriteImports(text, file, replace)` 也可从 `@graphframework/refactor` 根入口导入。CLI 修改源码后仍必须跑目标包类型检查与针对性测试；工具不会替代语义验证。

## 3. 统一导出规则

- 可复用接口必须从子包根入口导出；外部代码不得新增 `src/*` 深层依赖。
- 命令行入口通过 `bin` 或根 `run.sh` 暴露；`run/src/cli.mjs` 与 `supervisor.sh` 是实现细节。
- 新增导出时更新 `run/src/public-entrypoints.test.mjs`，确保所有工具包根入口可解析。

完成标准：职责归属唯一、公开入口可解析、文档命令存在且不绕过 `run.sh`、目标包测试与两套仓库强制类型检查通过。
