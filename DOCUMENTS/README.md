---
type: index
title: GraphFramework 文档中心
description: GraphFramework 知识库 GitHub 阅读导航总入口，采用“目标入口 → 决策模型 → 权威参考”三层结构。
---

# GraphFramework 文档中心

GraphFramework 是一个面向桌面与后端系统的因果应用框架。本知识库采用**三层结构**组织：
1. **目标入口**：回答“我现在要完成什么”，端到端串联任务；
2. **决策模型**：回答“为什么这样做、能力放在哪一层”，阐明设计边界；
3. **权威参考**：回答“准确的接口、协议、契约和命令是什么”，维护唯一事实。

信息冲突时，以源码与针对性测试为准，其次是 [核心心智模型](architecture/mental-model.md)。

---

## 第一层：目标入口

请直接根据你当前的任务目标选择对应指南，无需先翻阅底层架构或协议细节：

| 你现在要做什么 | 目标入口 |
| :--- | :--- |
| **第一次准备开发环境** | [第一次准备开发环境](goals/first-setup.md) |
| **开发第一个业务功能** | [开发第一个业务功能](goals/build-feature.md) |
| **接入文件、网络、设备或外部任务** | [接入文件、网络、设备或外部任务](goals/integrate-external-world.md) |
| **增加桌面界面与交互** | [增加桌面界面](goals/build-ui.md) |
| **创建和运行独立 run** | [创建和运行独立 run](goals/run-application.md) |
| **为改动补测试并提交** | [为改动补测试并提交](goals/verify-change.md) |
| **排查业务因果链不推进** | [排查因果链不推进](goals/debug-causal-flow.md) |
| **打包、安装或更新能力** | [打包、安装或更新能力](goals/distribute-capability.md) |
| **开发或开放内核能力** | [开发或开放内核能力](goals/evolve-kernel.md) |
| **接入其他编程语言（Python/Go/C++）** | [接入其他编程语言](goals/add-language-runtime.md) |

---

## 第二层：决策与心智模型

在遇到架构归属、分层决策或边界划分疑问时，参阅以下稳定心智模型：

- [核心心智模型与不可破坏公理](architecture/mental-model.md)：运行本体、权限边界、Rust 原生微内核调度与不可破坏公理。
- [平台 SDK 心智模型](architecture/sdk-mental-model.md)：面向平台维护者的包职责、依赖方向与代码归属。
- [开发准入约束与架构红线](architecture/development-constraints.md)：新增 Kernel、Node、字段与物理能力前的归属检查与 Kernel 五项检查。
- [命名 run 生命周期与 generation 断代](architecture/application-lifecycle.md)：`run.sh` 启停阶段、对称平稳停机语义与 generation 破坏性断代机制。

---

## 第三层：权威参考

本层维护确切的接口规约、通信协议、分发契约与操作命令，作为全仓唯一事实：

### 1. SDK 与开发参考
- [Node 与 Kernel SDK 指南](guides/kernel-sdk-guide.md)：调度、submission 与 NativeRuleSpace 规约。
- [Plugin SDK 指南](guides/plugin-sdk-guide.md)：Manifest 规范、插件装配、rendererRoots 授权与替换语义。
- [Client 与 Element SDK 指南](guides/client-sdk-guide.md)：前端快照、客户端 hooks 与 Workbench Element 规范。
- [测试分层与验证命令](guides/testing.md)：测试分类、针对性测试命令与选用规则正本。
- [达芬奇设计系统](guides/design-system.md)：主题、语义 CSS Token 与排版规范。

### 2. 底层通信与跨语言协议
- [常驻 Rust 图宿主协议](protocols/kernel-daemon-protocol.md)：语言无关 worker/provider 租约机制与 poll/commit 调度。
- [跨语言 Node 与分析事实协议](protocols/portable-node-protocol.md)：进程 Node 帧、Rust C ABI 与便携事实格式（`EncodedValue`）。

### 3. 协作与分发契约
- [插件全景与契约索引](contracts/plugins-reference.md)：业务插件规范、Node/Info/Element 清单与内核稳定消费规约。
- [插件发布与协作契约](contracts/plugin-collaboration-contract.md)：正式插件所有权、禁止污染、独立插件扩展与发布规则。
- [SDK、插件与飞书协作分发契约](contracts/distribution-contract.md)：飞书双通道分享、七能力面镜像、独立制品、版本兼容与性能要求。
- [多 Agent 独立开发与运行协作指南](contracts/multi-agent-run-guide.md)：已确认的命名 run、目录所有权与 Bash 启停并行隔离规范。

### 4. 排障、分析与 Agent 技能
- [Node 实例因果调试](diagnostics/debug-guide.md)：从精确实体定位因果断点。
- [实例因果分析](diagnostics/causal-analysis.md)：静态索引、路径、视角、健康和社区结果的证据边界。
- [Agent 专有技能与指南](diagnostics/agent-guides/)：包含因果分析、重构与主题色彩管理技能。

### 5. 规范标准定义
- [OKF 0.2 规范全文](standards/SPEC.md)：Open Knowledge Format 官方完整规范。
- [OKF 本地采纳约定](standards/okf.md)：知识包形状约定、采纳字段与校验规则。

---

## 唯一合法运行命令

```bash
# 校验 run 配置
node packages/tooling/run/src/cli.mjs validate runs/<name>/run.config.json

# 启动 run
bash ./run.sh start runs/<name>/run.config.json

# 查看状态
bash ./run.sh status runs/<name>/run.config.json

# 平稳停止 run
bash ./run.sh stop runs/<name>/run.config.json
```

Windows 用户亦可使用 `runs/<name>/start.cmd`、`status.cmd` 和 `stop.cmd`。严禁通过 `npm start` 或直接拉起 Electron 绕过统一 run。
