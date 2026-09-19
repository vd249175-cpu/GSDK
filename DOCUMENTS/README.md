---
type: index
title: GraphFramework 文档导航
description: GraphFramework 知识库 GitHub 阅读导航总入口。
---

# GraphFramework 文档导航

GraphFramework 是一个面向桌面与后端系统的因果应用微内核运行时。本知识库遵循 [Open Knowledge Format (OKF) 0.2](standards/SPEC.md) 组织，按架构事实与开发阶段分层维护。

出现冲突时，以源码与针对性测试为准，其次是 `architecture/mental-model.md`。

## 目录分层与快速导航

### 1. 核心架构与心智模型 ([architecture/](architecture/))
- [当前心智模型](architecture/mental-model.md)：运行本体、权限边界、原生微内核调度与不可破坏公理。
- [SDK 心智模型](architecture/sdk-mental-model.md)：包职责、依赖方向和代码归属。
- [命名 run 生命周期](architecture/application-lifecycle.md)：run.sh 启停阶段、关闭语义与 generation 破坏性断代机制。
- [开发准入约束](architecture/development-constraints.md)：新增 Kernel、Node、字段与物理能力前的归属检查。

### 2. 底层与跨语言协议 ([protocols/](protocols/))
- [常驻 Rust 图宿主协议](protocols/kernel-daemon-protocol.md)：语言无关 worker/provider 租约机制与 poll/commit 调度。
- [跨语言 Node 与分析事实协议](protocols/portable-node-protocol.md)：进程 Node 帧、Rust C ABI 与便携分析快照。

### 3. 开发者与 SDK 指南 ([guides/](guides/))
- [Kernel 与 Node SDK](guides/kernel-sdk-guide.md)：Node、WorldNode、submission 与 NativeRuleSpace 原生规则空间。
- [Plugin SDK](guides/plugin-sdk-guide.md)：插件装配、rendererRoots、Manifest 与热替换边界。
- [Client 与 Element SDK](guides/client-sdk-guide.md)：前端快照、客户端 hooks 与 Workbench Element。
- [设计系统](guides/design-system.md)：主题、语义 Token 与排版规范。
- [测试分层](guides/testing.md)：当前测试项目、命令与选用规则。

### 4. 协作、分发与演进契约 ([contracts/](contracts/))
- [插件全景与契约索引](contracts/plugins-reference.md)：业务插件规范、Node/Info/Element 清单与内核稳定消费规约。
- [插件发布与协作契约](contracts/plugin-collaboration-contract.md)：正式插件所有权、禁止污染、独立插件扩展与发布规则。
- [SDK、插件与飞书协作分发契约](contracts/distribution-contract.md)：飞书知识库与群聊双通道分享、七能力面镜像、独立制品、版本兼容与性能要求。
- [多 Agent 独立开发与运行协作指南](contracts/multi-agent-run-guide.md)：已确认的命名 run、目录所有权与 Bash 启停并行隔离规范。
- [统一 run 实施计划](contracts/unified-run-plan.md)：默认应用、图片段和场景测试迁入统一配置驱动运行机制。

### 5. 排障、分析与 Agent 技能 ([diagnostics/](diagnostics/))
- [Node 实例因果调试](diagnostics/debug-guide.md)：从精确实体定位因果断点。
- [实例因果分析](diagnostics/causal-analysis.md)：静态索引、路径、视角、健康和社区结果的证据边界。
- [Agent 专有技能与指南](diagnostics/agent-guides/)：包含因果分析、重构与主题色彩管理技能。

### 6. 规范标准定义 ([standards/](standards/))
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
