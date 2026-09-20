---
type: Developer Guide
title: 测试分层与验证规范
description: 针对性测试分层原则、Vitest/Rust/Python 测试套件与本地验证命令指引。
status: stable
tags: [testing, vitest, cargo-test, verification, tdd]
---

# 测试分层与验证入口

根目录不持有 npm 构建或测试工作区。按改变的责任边界选择针对性测试。

| 范围 | 位置 | 入口 |
| --- | --- | --- |
| 命名 run（配置/装配/场景/启停） | `packages/tooling/run/src` + `packages/desktop/host/p*-run-*.test.mjs` | `npm --prefix packages/desktop test -- host/p1-run-isolation.test.mjs host/p3-run-lifecycle.test.mjs host/p4-frontend-discovery.test.mjs host/p5-run-scenario.test.mjs host/p8-factory-instances.test.mjs host/p9-bash-lifecycle.test.mjs --silent` |
| JavaScript SDK | `packages/sdk/javascript/tests` | `npm --prefix packages/sdk/javascript test -- <目标> --silent` |
| 桌面宿主 | `packages/desktop/host`、`application.test.mjs` | `npm --prefix packages/desktop test -- <目标> --silent` |
| 插件 | `app/plugins/*` | 桌面测试配置加载相应插件测试；新拆分插件将测试放在插件的 `tests/` 中 |
| 前端工作台与主题 | `packages/frontend/*` | 桌面测试配置提供 jsdom 环境 |
| Python SDK | `packages/sdk/python/tests` | `python -m pytest packages/sdk/python/tests` |
| Rust | `packages/rust` | `cargo test --manifest-path packages/rust/Cargo.toml -p <crate>` |

桌面测试排除 node_modules、构建产物与真实外部服务测试。使用真实 Node 和生产调度或 SDK 测试运行时，只替换构造注入的 Adapter；断言 State、Info、Effect、Projection 和 submission 结算。

## 验证命令（唯一正本）
本文是验证命令的唯一正本；其他文档只给指针，不复述命令块（复述是上次 `diagnose` 改名连带 8 个文件的原因）。
```bash
npm --prefix packages/sdk/javascript run typecheck
npm --prefix packages/desktop run typecheck
npm --prefix packages/desktop run check:renderer-boundary
npm --prefix packages/desktop test -- <目标> --silent
node app/plugins/backend/hello-counter/scripts/diagnose.mjs validate
node app/plugins/backend/hello-counter/scripts/diagnose.mjs <node|change|info|state|expand|path|select|frontend|health|reach> [args]
npm --prefix packages/desktop run build
npm --prefix packages/desktop run verify:native-load
git diff --check
```
- SDK 本地环：`npm --prefix packages/sdk/javascript test -- <目标> --silent` 跑 JS SDK 单测；动原生绑定另加 `cargo build --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-node && node packages/rust/scripts/stage-native.mjs` 与 `node packages/rust/scripts/stage-backend-native.mjs`。
- 桌面全回归：`npm --prefix packages/desktop run verify`（= 边界 + 类型 + 测试 + counter 校验 + native-load + 构建）。
- 诊断命令只校验 hello-counter 示例（仓库根目录直接 `node` 运行，无桌面转发脚本）；改其它插件时用该插件实际装配的 Node/事实校验，或查询运行中宿主的 Agent `analyze { op: 'validate' }`。
SDK 类型检查不依赖 frontend；客户端泛型断言位于 `packages/frontend/client/typecheck.ts`，由桌面 renderer 类型检查包含。Electron smoke 加载实际桌面宿主构建产物和 Rust .node，验证调度、Projection 与清理。诊断命令使用 JS SDK 源码条件，不启动桌面应用。

## 按变更选择最小验证

| 改动 | 最小验证 |
| --- | --- |
| Rust mailbox、single-flight、submission、取消或 generation | 对应 Cargo 测试 + JS 原生桥测试；不以 TS Oracle 代替生产 Rust 验收 |
| JS Node 底座与测试 Oracle | SDK tests 中对应测试 + SDK 类型检查 |
| Node/Info/State/rendererRoots | 对应插件测试、类型检查与当前插件事实校验 |
| NativeRuleSpace、进程 Node 或 Agent 接口 | SDK tests 中对应 native/process/agent 测试 + 类型检查 |
| daemon / Python 镜像 | Rust daemon 测试、Python 对应测试与共同黄金帧 |
| 前端组件、主题、Context 或 Element 生命周期 | 桌面配置中对应 frontend/Element 测试与 renderer 类型检查 |
| Rust 分析算法 | `graphframework-analysis` 对应 Cargo 测试与跨入口 DTO 用例 |
| JS 事实提取与显式离线分析 | SDK tests 中对应分析测试 |
| Electron 或源码构建边界 | renderer 边界、类型、main/renderer build、Electron smoke；需要整体应用回归时运行 desktop verify |

`diagnose.mjs validate` 只校验 hello-counter 示例（命令见上文 §验证命令）。修改其它插件时，必须用该插件实际装配的 Node/事实校验，或查询运行中宿主的 Agent `analyze { op: 'validate' }`；counter 校验通过不能代表其它插件正确。

## Node 与 Effect 测试原则

- 使用真实业务 Node，不复制 change 逻辑；单 Node 优先使用 createTestRuntime，生产调度语义用 NativeRuleSpace/Rust 测试。
- 只替换构造注入的 Adapter，覆盖成功、失败、延迟与取消。
- 最小装配明确列出 Node；边界外输出用 Collector 接收，不复制对方 State Owner。
- 断言 State、边界 Info、Effect Request/Observation、Projection 和 submission 结算。
- 固定 Clock、IdProvider 和可控 Promise；每次测试创建并销毁独立 Runtime，防止 capability 与资源泄漏。

## Python 与原生运行准备

在仓库根目录安装 Python SDK 及测试依赖，然后按目标运行：

```bash
python -m pip install -e packages/sdk/python
python -m pip install pytest pytest-asyncio
python -m pytest packages/sdk/python/tests/test_mirror.py
cargo build --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-daemon
python -m pytest packages/sdk/python/tests/test_daemon.py
```

daemon 测试寻找 `packages/rust/target/debug/` 的本机二进制；不存在时会 skip，不能把跳过当作跨语言验收通过。协议黄金帧在 `packages/contract/golden-frames/`。

源码测试通过不等于 Electron 产物可加载。构建前按 Kernel 指南生成并 stage 原生绑定；desktop `verify` 检查已有绑定，不自动执行 Cargo build，也不承担 Rust/Python 全部测试。跨宿主传递 Node/Context 时还要核对是否出现重复运行模块及 capability；当前源码构建通过明确 SDK 源码入口装配。

## 性能基准与平台边界

`packages/rust/scripts/benchmark-native.mjs` 测量 Rust/N-API 原始循环及替换延迟，绑定默认来自 Rust 包内 kernel-node；可用 GRAPHFRAMEWORK_NATIVE_NODE 指定已构建绑定。

```bash
cargo build --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-node --release
node packages/rust/scripts/stage-native.mjs --release
node --expose-gc packages/rust/scripts/benchmark-native.mjs --iterations 20000 --rounds 5
```

保留的参考基线为 win32-x64-msvc release、20,000 change × 5 轮，约 21.3–23.2 万 change/s；空闲实体替换 p50 0.6µs、p95 0.9µs、p99 1.2µs。这是已有文档记录的原始调度量级，本次文档更新没有重新测量，不能作为当前机器或完整业务链路吞吐承诺。对比时记录机器、Node/Electron 版本、构建模式、轮数与内存，并分别测量宿主 change 和跨进程成本。

平台映射覆盖 win32-msvc、linux-gnu 与 darwin；映射代码存在不等于各平台二进制都已构建或验证。Electron smoke 使用 desktop 包实际安装的 Electron，不沿用旧版本加载结论。

## 文档变更验证

文档-only 变更检查 OKF frontmatter、Markdown 链接、源码路径、npm/Cargo 命令与示例公开 exports，并执行 `git diff --check`。不因修正文档重复运行无关的全量测试。
