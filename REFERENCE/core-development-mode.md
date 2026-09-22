---
type: Developer Guide
title: 核心开发模式全景指南 (core-development-mode.md)
description: 平台底层核心开发规约：涵盖 Rust 核心 (packages/rust)、核心 Packages (packages/*) 与核心 Plugins (app/plugins/*) 的三位一体架构。
status: stable
tags: [core-development, mental-model, rust-kernel, core-packages, core-plugins, app-plugins, standards]
---

# 核心开发模式全景指南 (`core-development-mode.md`)

在 GraphFramework 体系中，**“核心开发（Core Development）”**是全仓最基石的研发模式。它不仅指代底层微内核，而是由**三大支柱**紧密构成的有机整体：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        核心开发体系 (Core Development)                 │
│                                                                        │
│  ┌──────────────────────┐  ┌────────────────────┐  ┌────────────────┐  │
│  │     1. Rust 核心     │  │  2. 核心 Packages   │  │ 3. 核心 Plugins│  │
│  │ (packages/rust)      │  │ (packages/*)       │  │ (app/plugins)  │  │
│  │                      │  │                    │  │                │  │
│  │ • 纯物理规则空间     │  │ • 多语言 SDK       │  │ • 官方基准演示  │  │
│  │ • 单飞调度与断代     │  │ • Electron 桌面宿主│  │ • 浏览器录制器  │  │
│  │ • 进程守护进程       │  │ • 零业务工作台底座  │  │ • OS 桌面录制器 │  │
│  │ • 高维因果分析引擎   │  │ • 运行工具与可视化  │  │ • UFO 电脑控制  │  │
│  │                      │  │ • 统一机器契约     │  │ • 联合录制引擎  │  │
│  └──────────────────────┘  └────────────────────┘  └────────────────┘  │
│            ▲                         ▲                      ▲          │
│            └─────────────────────────┴──────────────────────┘          │
│                    全仓通过基础软件更新包统一发布与版本演进               │
└────────────────────────────────────────────────────────────────────────┘
```

与在 `runs/*` 目录下的业务工作流开发不同，**核心开发的所有代码属于全仓基础设施资产**，遵循最严格的零业务语义隔离、跨语言行为一致性与架构红线守卫。

---

## 1. 核心开发的三大支柱与源码归属

### 支柱一：Rust 核心 (`packages/rust`)
生产级唯一物理规则空间与因果拓扑分析底座：
- **微内核核心 (`kernel`)**：提供无锁/低锁单线程因果泵驱动、FIFO Mailbox 队列管理、实体单飞（Single-flight）排他性调度、破坏性代数（Generation）断代与丢弃台账（Drop Ledger）。
- **跨语言绑定与宿主 (`kernel-node`, `kernel-ffi`, `kernel-daemon`)**：
  - `kernel-node`：Node.js N-API 高性能本地绑定，驱动 TypeScript `NativeRuleSpace`；
  - `kernel-ffi`：面向 Python、C++ 等多语言的 C ABI 动态链接库；
  - `kernel-daemon`：支持多 Session 租约、Effect 异步外派的 TCP JSON Lines 常驻宿主进程（26 项 operation，见机器契约）。
- **因果分析引擎 (`analysis`)**：零运行时纯静态拓扑大脑，提供环路死锁检测、可达矩阵、Brandes 介数中心性与 Louvain 社区划分算法。
- **核心开发守则**：绝对零业务语义；任何行业名词、业务字段严禁进入 Rust 代码。

### 支柱二：核心 Packages (`packages/*`)
支撑上层运行的跨语言基础软件套件：
- **`packages/sdk` (多语言 SDK)**：
  - `javascript/`：提供 `Node`、`ExecutionWorldNode`、`ObservationWorldNode` 基类、`DomainChangeContext` / `WorldChangeContext` 上下文、`NativeRuleSpace` 适配器以及纯内存单测 Harness；
  - `python/`：提供 Python 生态对齐的 `KernelDaemonClient` 与 Worker 接口。
- **`packages/desktop` (通用桌面宿主)**：提供 Electron 运行时物理端口、Preload IPC 上下文隔离与 `run.sh` 架构守卫。
- **`packages/frontend` (前端底座)**：零业务语义工作台（`workbench`）、达芬奇瑞士风设计系统（`theme`）与响应式客户端 Hooks（`client`）。
- **`packages/tooling` (工具链)**：统一启动管理器（`run/`）、瑞士风 2D 交互式因果可视化器（`causal-visualizer/`）与 AST 重构工具（`refactor/`）。
- **`packages/contract` (机器契约)**：维护全仓唯一的声明式 26 项协议操作（`operations.json`）、标准化错误码（`errors.json`）与跨语言回归 Golden Frames。

### 支柱三：核心 Plugins (`app/plugins/*`)
随**基础软件更新包**统一分发的官方核心基础设施插件（严禁放置未经验收的临时代码）：
- **基准演示与测试插件**：
  - `app/plugins/backend/demo-topology` & `app/plugins/frontend/demo-topology`：官方订单履约因果拓扑基准实现；
  - `app/plugins/backend/hello-counter`：极简计数器参考实现与离线拓扑体检（`diagnose.mjs`）范例。
- **系统级基础设施能力插件**：
  - `app/plugins/backend/browser-recorder` & `app/plugins/frontend/browser-recorder`：浏览器操作原生录制核心插件；
  - `app/plugins/backend/os-recorder` & `app/plugins/frontend/os-recorder`：Windows 桌面系统动作录制与步骤捕获核心插件；
  - `app/plugins/backend/ufo-computer-control`：基于微软 UFO 的 Windows UIA 桌面控制与控件巡检核心插件；
  - `app/plugins/backend/unified-recorder` & `app/plugins/frontend/unified-recorder`：跨 OS 与浏览器的联合录制驱动核心插件。
- **核心插件准入原则（源码依据）**：
  - 核心插件与工作流中的第三方插件遵循完全相同的 Manifest（`graphframework.plugin.json`）规范与生命周期契约（**插件平权**）；
  - **“核心”代表发布与维护归属**：只有经架构评审、被全仓认定为长期公共资产的平台级基础设施能力，才允许作为核心插件存放在 `app/plugins/` 下，随基础软件包统一发布；所有业务性、场景化、临时测试的插件绝不进入 `app/plugins/`。

---

## 2. 核心开发的 5 项架构公理与不可触碰红线

在核心开发（无论是修改 Rust 内核、调整 SDK，还是演进 `app/plugins/` 中的核心插件）时，必须严格执行准入审查：

1. **绝对零业务语义穿透**：
   - 调度微内核与工作台底座必须对业务完全无感。任何特定场景的字段、业务规则只存在于插件内部。
2. **物理执行与观察严格分离**：
   - 核心插件中的 WorldNode 必须物理拆分为两类：
     - **`ExecutionWorldNode`**：主动发外部动作、改外部状态、拿 handle 立即结算，零监听；
     - **`ObservationWorldNode`**：只读监听系统/网络/硬件事件，将事实封装为 Info send 回业务图，零主动写。
3. **因果异常同权 (Error as Info)**：
   - 任何 Node 的内部执行报错必须在代码层被安全捕获为 `@error/NodeFailed` 脉冲，绝不允许让未捕获异常击穿规则空间。
4. **非核心插件不入 `app/` 铁律**：
   - `app/plugins/` 仅承载上述官方核心插件；任何业务流程、自动化策略或实验性质的节点，必须先在 `runs/<name>/plugins/` 中开发与单测，严禁直接在 `app/plugins/` 建未测试目录。
5. **契约先行 (Contract First)**：
   - 任何涉及跨语言、跨进程协议改动，必须先在 `packages/contract/operations.json` 中更新契约与 Golden Frames，并通过全套测试验收。

---

## 3. 核心开发工程纪律与开发流程

### 3.1 本地测试驱动开发
- 修复缺陷或扩展能力时，**先写最小复现单测**（利用 `@graphframework/sdk/testing` 的 `createTestRuntime`）；
- 排障优先针对最小局部切片，严禁直接启动 Electron 黑盒界面进行肉眼盲测；
- 严禁用 `node -e` 拼凑临时验证脚本。

### 3.2 LSP 优先与安全重构
- 符号重命名、跳转分析、类型定义查找及重构操作，严格优先使用 LSP 工具，确保语义与类型安全；
- 跨包批量重构使用 `node packages/tooling/refactor/refactor.mjs`。

### 3.3 提交前强制门禁
在提交 Git 检查点（Checkpoint）前，必须通过双重严格类型检查：
```bash
# 1. 桌面宿主类型检查（主进程 + 渲染进程）
npm --prefix packages/desktop run typecheck

# 2. JavaScript / TypeScript SDK 类型检查
npm --prefix packages/sdk/javascript run typecheck

# 3. 若改动了 Rust 微内核或分析引擎代码
cargo test --manifest-path packages/rust/Cargo.toml
```

---

## 4. 相关核心文档导航

- [核心心智模型与 13 条不可破坏公理](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/architecture/mental-model.md)
- [开发准入约束与架构红线](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/architecture/development-constraints.md)
- [机器契约与 26 项协议操作全集](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/contract/README.md)
- [工作流开发模式指南](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/workflow-development-mode.md)
