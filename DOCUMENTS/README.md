---
type: index
title: GraphFramework 文档导航
description: GraphFramework 知识库 GitHub 阅读导航总入口。
---

# GraphFramework 文档导航

GraphFramework 是一个面向桌面与后端系统的因果应用框架。本知识库默认从业务任务出发；开发普通业务功能不需要先理解内核或 SDK 实现。

出现冲突时，以源码与针对性测试为准，其次是 `architecture/mental-model.md`。

## 从这里开始

| 你现在要做什么 | 只需先读 |
| --- | --- |
| 新增业务规则、后台自动化或一个新插件 | [业务开发入门](guides/application-development.md) |
| 为已有功能补测试 | [测试分层](guides/testing.md) |
| 新增桌面页面、面板或命令 | [业务开发入门](guides/application-development.md) → [Client 与 Element SDK](guides/client-sdk-guide.md) |
| 接入文件、网络、数据库或外部任务 | [业务开发入门：接入外部世界](guides/application-development.md#接入外部世界) |
| 排查业务链路为什么没有推进 | [Node 实例因果调试](diagnostics/debug-guide.md) |
| 维护运行宿主、内核或跨语言协议 | [平台维护者文档](architecture/) |

首次开发建议直接从 `app/plugins/backend/hello-counter/` 和 `runs/alice/` 复制最小样例。只有遇到底层边界问题时再下钻架构与协议文档。

## 参考资料分层

### 1. 业务开发与界面指南 ([guides/](guides/))

- [业务开发入门](guides/application-development.md)：Node、插件、测试、run 装配与启动的默认路径。
- [测试分层](guides/testing.md)：当前测试项目、命令与选用规则。
- [Client 与 Element SDK](guides/client-sdk-guide.md)：前端快照、客户端 hooks 与 Workbench Element。
- [设计系统](guides/design-system.md)：主题、语义 Token 与排版规范。

### 2. 平台架构与心智模型 ([architecture/](architecture/))
- [当前心智模型](architecture/mental-model.md)：运行本体、权限边界、原生微内核调度与不可破坏公理。
- [平台 SDK 心智模型](architecture/sdk-mental-model.md)：面向平台维护者的包职责、依赖方向和代码归属。
- [命名 run 生命周期](architecture/application-lifecycle.md)：run.sh 启停阶段、关闭语义与 generation 破坏性断代机制。
- [开发准入约束](architecture/development-constraints.md)：新增 Kernel、Node、字段与物理能力前的归属检查。

### 3. 底层与跨语言协议 ([protocols/](protocols/))
- [常驻 Rust 图宿主协议](protocols/kernel-daemon-protocol.md)：语言无关 worker/provider 租约机制与 poll/commit 调度。
- [跨语言 Node 与分析事实协议](protocols/portable-node-protocol.md)：进程 Node 帧、Rust C ABI 与便携分析快照。

### 4. SDK 与宿主高级参考

- [Plugin SDK](guides/plugin-sdk-guide.md)：Manifest、装配、rendererRoots、信任边界与替换语义。
- [Kernel 与 Node SDK](guides/kernel-sdk-guide.md)：调度、submission 与 NativeRuleSpace。

### 5. 协作、分发与演进契约 ([contracts/](contracts/))
- [插件全景与契约索引](contracts/plugins-reference.md)：业务插件规范、Node/Info/Element 清单与内核稳定消费规约。
- [插件发布与协作契约](contracts/plugin-collaboration-contract.md)：正式插件所有权、禁止污染、独立插件扩展与发布规则。
- [SDK、插件与飞书协作分发契约](contracts/distribution-contract.md)：飞书知识库与群聊双通道分享、七能力面镜像、独立制品、版本兼容与性能要求。
- [多 Agent 独立开发与运行协作指南](contracts/multi-agent-run-guide.md)：已确认的命名 run、目录所有权与 Bash 启停并行隔离规范。
- [统一 run 实施计划](contracts/unified-run-plan.md)：默认应用、图片段和场景测试迁入统一配置驱动运行机制。

### 6. 排障、分析与 Agent 技能 ([diagnostics/](diagnostics/))
- [Node 实例因果调试](diagnostics/debug-guide.md)：从精确实体定位因果断点。
- [实例因果分析](diagnostics/causal-analysis.md)：静态索引、路径、视角、健康和社区结果的证据边界。
- [Agent 专有技能与指南](diagnostics/agent-guides/)：包含因果分析、重构与主题色彩管理技能。

### 7. 规范标准定义 ([standards/](standards/))
- [OKF 0.2 规范全文](standards/SPEC.md)：Open Knowledge Format 官方完整规范。
- [OKF 本地采纳约定](standards/okf.md)：知识包形状约定、采纳字段与校验规则。

---

## 首次源码接入

完整的新成员环境探测、工具安装、飞书 CLI/Skills 与 `user-default` 授权流程以仓库 `AGENTS.md` §9 为准。源码依赖在仓库根目录执行，使用本机 Rust 工具链：

```bash
npm --prefix packages/sdk/javascript ci
npm --prefix packages/desktop ci
cargo build --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-node
node packages/rust/scripts/stage-native.mjs
node packages/rust/scripts/stage-backend-native.mjs
npm --prefix packages/desktop run build
```

启动命令：`bash ./run.sh start runs/<name>/run.config.json`（`packages/desktop/host/main.mjs` 拒绝直接 `npm start` 拉起；唯一合法入口见仓库 `AGENTS.md` §8）。

## 常用验证
命令正本只在 [测试分层](guides/testing.md) §验证命令 维护：
```bash
npm --prefix packages/sdk/javascript run typecheck
npm --prefix packages/desktop run typecheck
npm --prefix packages/desktop test -- <目标> --silent
node app/plugins/backend/hello-counter/scripts/diagnose.mjs validate
npm --prefix packages/desktop run verify
cargo test --manifest-path packages/rust/Cargo.toml -p <crate>
```
