---
type: Architecture Specification
title: 工具链与因果全息观测套件 (packages/tooling)
description: 统一进程管理器 (run)、瑞士风因果可视化器 (Causal Visualizer) 与重构工具集。
status: stable
tags: [tooling, run, causal-visualizer, refactor, supervisor]
---

# 工具链与因果全息观测套件 (`packages/tooling`)

源码目录：[`packages/tooling/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/tooling)

`packages/tooling` 提供全仓日常开发、运行生命周期守卫、代码自动化重构与因果链路可视化排障的完整工具链。

---

## 1. 核心工具三大支柱

| 工具模块 | 所在目录 | 核心职责 |
| :--- | :--- | :--- |
| **统一运行管理器** | [`run/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/tooling/run) | 驱动根目录 `run.sh`，管理命名 run 生命周期、PID 互斥锁、平稳停机与 Supervisor 守护 |
| **因果全息可视化器** | [`causal-visualizer/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/tooling/causal-visualizer) | 瑞士现代主义（Swiss-2D）交互式可视化器，直观呈现全图拓扑、脉冲动画与节点状态 |
| **代码规范与重构工具** | [`refactor/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/tooling/refactor) | 自动化布局检测（`check-layout.mjs`）、跨包 Import 安全重写与批量符号迁移 |

---

## 2. 详细工具指南

- **[统一运行管理器深入规约 (`run.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/tooling/run.md)**：`run.config.json` 解析规则、命名 run 启停阶段与环境隔离。
- **[瑞士风因果可视化器使用手册 (`causal-visualizer.md`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/tooling/causal-visualizer.md)**：独立 Web 渲染器启动、遥测服务端（Telemetry Server）接入与拓扑排障交互。
