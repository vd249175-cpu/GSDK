---
type: Developer Guide
title: GraphFramework 核心 Packages 开发入口
description: 核心包的职责边界、选择路径、统一导出约定、最短开发流程与验收命令。
status: stable
tags: [packages, quick-start, public-api, exports, testing]
---

# GraphFramework 核心 Packages 开发入口

本页是 `packages/*` 的开发起点。读完本页即可选择目标包、找到唯一公开入口、完成最小修改并运行对应验证；子目录 README 是接口字典，不是开始开发的前置阅读。

## 1. 先选择唯一归属

| 需求 | 修改目录 | 公开入口 | 最小验证 |
| :--- | :--- | :--- | :--- |
| 调度、generation、mailbox、daemon、跨语言 ABI | `packages/rust` | Rust crate 的 `lib.rs` 与 daemon 协议 | `cargo test --manifest-path packages/rust/Cargo.toml` |
| Node、Info、Effect、插件、分析客户端、测试工具 | `packages/sdk` | JS 的 `@graphframework/sdk/<face>`；Python 的 `graphframework_sdk.<face>` | JS typecheck/test；Python pytest |
| Electron 宿主、preload、运行守卫 | `packages/desktop` | 包内 host/preload 入口 | desktop typecheck 与针对性测试 |
| 零业务工作台、客户端、主题与 UI 底座 | `packages/frontend` | 各子包的公开 package entry | 对应子包 typecheck/test |
| run 生命周期、构建、重构与可视化工具 | `packages/tooling` | 各工具目录的 CLI/模块入口 | 对应工具测试 |
| 跨语言机器协议 | `packages/contract` | `operations.json`、`errors.json`、golden frames | contract 校验与跨语言测试 |
| Windows UFO 接入 | `packages/ufo` | Python package public module | Python 针对性测试；真机验证必须串行 |

若一项需求同时命中多个包，先改最底层契约，再逐层适配；不得让上层复制一份同名协议或状态。

## 2. 统一公开导出约定

每种语言保留自己的惯用实现，但公开入口必须唯一、可测试、与内部文件布局解耦：

- TypeScript/JavaScript：每个能力面由 `src/<face>/index.ts` 汇总，`package.json#exports` 和构建 entry 必须同时声明；消费者只从包子路径导入，不直接引用 `src/**`。
- Python：每个能力面由 `<face>/__init__.py` 汇总并声明 `__all__`；跨能力面的主类型从所属能力面重导出，消费者不从实现文件导入。
- Rust：每个 crate 由 `src/lib.rs` 暴露公共模块；跨 crate 契约放在拥有该语义的 crate，不通过路径依赖内部模块。
- JSON 契约：文件本身就是公开入口；字段、错误码或操作变化必须同步 golden frames。

SDK 已采用七个同名能力面：`protocol / node / effect / plugin / analysis / agent / testing`。例如：

```ts
import { Node } from '@graphframework/sdk/node';
import { createTestRuntime } from '@graphframework/sdk/testing';
```

```python
from graphframework_sdk.agent import KernelDaemonClient
from graphframework_sdk.node import run_daemon_node_worker
```

新增公开 API 时必须同时完成：实现导出、包清单/构建入口（如适用）、README 接口表、导出契约测试。缺一项即不算完成。

## 3. 最小开发闭环

1. 先读 [`../architecture/mental-model.md`](../architecture/mental-model.md)，确认所有权、Info、WorldNode 与 generation 边界。
2. 在本页选择唯一归属，打开对应 package README 的“开始开发”段。
3. 先写最小复现或导出契约测试，再修改实现；领域测试不得启动真实桌面或外设。
4. 只通过公开入口编写示例和测试，禁止用深层源码路径掩盖缺失导出。
5. 运行目标包的针对性测试，然后运行两项仓库强制类型检查：

```bash
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
```

涉及运行态验收时，只允许使用：

```bash
bash ./run.sh start runs/<name>/run.config.json
bash ./run.sh status runs/<name>/run.config.json
bash ./run.sh stop runs/<name>/run.config.json
```

## 4. 各包自包含入口

- [Rust 微内核与分析](rust/README.md)
- [机器契约](contract/README.md)
- [多语言 SDK](sdk/README.md)
- [桌面宿主](desktop/README.md)
- [前端底座](frontend/README.md)
- [工具链](tooling/README.md)
- [UFO Windows 接入](ufo/README.md)

完成标准：新开发者不查看源码即可选对包、从公开入口导入、运行最小测试；需要查字段或高级操作时才进入子目录接口字典。
