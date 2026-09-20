---
type: Developer Guide
title: 业务开发入门与任务导引
description: 业务开发者的核心心智导引与目标任务分流中心。
status: stable
tags: [getting-started, application, plugin, run, testing]
---

# 业务开发入门与任务导引

GraphFramework 面向业务开发者提供了清晰的因果驱动开发模型。业务开发无需理解 Rust 内核实现、daemon 内部调度或底层 FFI 规约。

为避免单篇文档承担过多目标，本指南已拆分为面向具体任务的独立目标页。

---

## 核心心智：四个词与单行链路

| 词 | 在业务代码里的含义 | 职责与行为 |
| :--- | :--- | :--- |
| **Node** | 一类业务事实及其处理规则 | 为持续存在的业务事实选一个唯一负责者 |
| **State** | 该 Node 当前保存的业务事实 | 只在该 Node 的 `change(info, ctx)` 中修改 |
| **Info** | 一次命令、事件或结果 | 用 `type` 区分，并发送给明确的目标 Node |
| **run** | 本次要启动的插件、实例和界面组合 | 在 `runs/<name>/` 中选择并启动 |

最核心的因果链路：

```text
收到 Info → 校验业务条件 → 更新自己的 State → 必要时向下一个 Node 发送 Info
```

---

## 任务目标导航

请根据你当前要完成的具体任务，直接跳转至对应目标页：

| 目标任务 | 详细指南 | 关键内容 |
| :--- | :--- | :--- |
| **编写第一个业务功能** | [开发第一个业务功能](../goals/build-feature.md) | Node 编写、插件声明、针对性单测与多节点协作 |
| **创建和启动自己的 run** | [创建和运行独立 run](../goals/run-application.md) | 装配 `assembly.mjs`、配置 `run.config.json` 与 `run.sh` 启停 |
| **连接文件、网络或外部服务** | [接入外部世界](../goals/integrate-external-world.md) | `ExecutionWorldNode` 与 `ObservationWorldNode` 物理分离与 Adapter 注入 |
| **构建桌面 UI 与交互** | [增加桌面界面](../goals/build-ui.md) | `rendererRoots` 授权门禁、Projection 只读订阅与达芬奇设计系统 |
| **测试与提交前验证** | [为改动补测试并提交](../goals/verify-change.md) | 提交前完成定义（DoD）、双类型检查与针对性测试 |
| **排查状态不推进或报错** | [排查因果链不推进](../goals/debug-causal-flow.md) | 4 步因果排障法与常见现象速查表 |
| **打包分发能力给他人** | [打包、安装或更新能力](../goals/distribute-capability.md) | `run.sh pack / verify / install` 与冲突解决三选一 |

---

## 锚点兼容导引

为兼容历史文档与书签中的锚点跳转，以下保留对应主题的直达指引：

### 第一个业务功能
详见：[开发第一个业务功能](../goals/build-feature.md)

### 多个 Node 协作
详见：[开发第一个业务功能：多节点协作](../goals/build-feature.md#步骤-4多节点因果协作)

### 接入外部世界
详见：[接入外部世界](../goals/integrate-external-world.md)

### 增加界面
详见：[增加桌面界面](../goals/build-ui.md)

### 常见问题按现象处理
详见：[排查因果链不推进：常见现象与速查表](../goals/debug-causal-flow.md#常见现象与速查表)

### 提交前完成定义
详见：[为改动补测试并提交：提交前完成定义](../goals/verify-change.md#提交前完成定义definition-of-done)
