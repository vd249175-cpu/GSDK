---
type: Architecture Specification
title: Electron 通用桌面宿主使用与运行规约 (packages/desktop)
description: 通用桌面宿主架构、唯一合法启动命令、Preload IPC 隔离与多窗口生命周期。
status: stable
tags: [desktop, electron, runtime-guardrails, run-sh, preload]
---

# Electron 通用桌面宿主使用与运行规约 (`packages/desktop`)

源码目录：[`packages/desktop/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/desktop)

`packages/desktop` 是全仓桌面端应用的物理载体。它基于 Electron 构建，集成 Rust 原生微内核，管理窗口生命周期、Preload 安全隔离以及前端渲染器（Renderer）的启动与加载。

---

## 1. 唯一合法启动命令（绝对运行守卫）

全仓所有桌面工作台、场景测试与后端服务，**唯一合法的运行入口是根目录的 `run.sh`**：

```bash
# 启动指定命名 run 的桌面工作台
bash ./run.sh start runs/main/run.config.json

# 检查当前桌面进程状态
bash ./run.sh status runs/main/run.config.json

# 平稳停机并释放所有窗口与后台进程
bash ./run.sh stop runs/main/run.config.json
```

> [!CAUTION]
> **严禁任何绕过统一 run 的旁路启动**：
> 严禁通过 `npm start`、`npx electron` 或临时脚本直接拉起 Electron 窗口！`packages/desktop/host/main.mjs` 中设置了强制架构守卫，直接启动将抛出致命异常并拒绝执行。

---

## 2. 桌面宿主工程结构

- [`host/main.mjs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/desktop/host/main.mjs)：Electron 主进程入口与启动参数校验；
- [`host/native-graph-host.mjs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/desktop/host/native-graph-host.mjs)：集成 Rust `NativeRuleSpace`，动态装配插件与 Node 实例；
- [`renderer/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/desktop/renderer)：通用 HTML 模板与达芬奇主题接入点；
- `preload.cjs`：上下文隔离脚本，通过 `contextBridge` 向前端暴露安全的只读投影和 IPC 调用，绝不向渲染进程暴露原生 Node.js / Electron 全局对象。

---

## 3. 验证与排错命令

在提交桌面端改动前，必须运行以下无头检查命令：

```bash
# 1. 严格类型检查（主进程 + 渲染进程）
npm --prefix packages/desktop run typecheck

# 2. 渲染器边界泄漏检查（确保无原生 API 击穿）
npm --prefix packages/desktop run check:renderer-boundary

# 3. 原生微内核加载验证
npm --prefix packages/desktop run verify:native-load
```
