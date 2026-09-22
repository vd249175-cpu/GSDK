---
type: Architecture Specification
title: GraphFramework 接口与工程参考中心 (REFERENCE)
description: 以项目真实代码布局与接口为基石的重构参考知识库总入口。零代码上手、无遗漏全量接口与能力货架。
status: stable
---

# GraphFramework 接口与工程参考中心 (REFERENCE)

本目录是 GraphFramework 全景文档体系的重构中心。**严格以工程代码布局、真实接口契约与确定性行为为基石，致力于“让人不看代码也会使用、在不开发代码的情况下可以直接用”**。

---

## 两种工作模式与开发指南 (Development Modes)

在 GraphFramework 体系中，开发者与 Agent 遵循物理隔离与分层准入原则，分别处于以下两种模式之一：

1. **[核心开发模式](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/core-development-mode.md)** (`core-development-mode.md` / [核心开发模式.md](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/核心开发模式.md))
   - **适用对象**：底层框架与核心资产维护者。
   - **核心范围**：**三大支柱**——**Rust 核心** (`packages/rust`)、**核心 Packages** (`packages/*`) 与 **核心 Plugins** (`app/plugins/*` 官方核心基础设施插件集）。
   - **行为准则**：微内核绝对零业务语义、世界节点物理分离（Execution/Observation）、LSP 优先精准重构、最小单测驱动、提交前双重严格类型检查。
2. **[工作流开发模式](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/workflow-development-mode.md)** (`workflow-development-mode.md` / [工作流开发模式.md](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/工作流开发模式.md))
   - **核心专栏**：👉 **[工作流开发全景指南 (REFERENCE/workflow/README.md)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/workflow/README.md)**
   - **适用对象**：不懂代码的纯小白业务用户与 Agent 智能体协同开发。
   - **黄金法则**：不盲从录制动作，遵循 **Agent 原生程度五级金字塔**（$\text{API} > \text{MCP} > \text{浏览器} > \text{桌面应用} > \text{像素模仿}$），主动搜索“XXX开放平台”并用工具带教用户配置。
   - **交互工具栈**：👉 **[Agent 技能与 MCP 工具箱全景规范](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/workflow/skills-and-mcp-tooling.md)**（浏览器 Playwright CLI / Chrome DevTools MCP 9343、阿里云免公网 Workbench CLI 毫秒级执行/1GB 传输、本地桌面 UFO 独占排他）。
   - **开发范围**：[`runs/*`](file:///c:/Users/kp157/Desktop/PM/GVSDK/runs)（独立 run、工作流专用插件 `runs/<name>/plugins/`、端到端场景组装）。
   - **隔离铁律**：非核心插件绝对不入 `app/`，独占 run 目录沙箱隔离，单测跑通后方可提至 `runs/main/plugins/`。


---

## 核心架构基石、测试规范与红线约束 (Architecture, Testing & Redlines)

在进行任何设计、编码、测试与重构前，必须研读并严格遵循以下架构公理与工程规约：

- **[核心心智模型与 13 条不可破坏公理](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/architecture/mental-model.md)** (`architecture/mental-model.md`)
  - 阐述六大运行本体（Node, State, Info, Change, Error as Info, Projection）、单飞执行排他性、破坏性代数断代（Generation Discontinuity）以及执行/观察物理分离公理。
- **[开发准入约束与 11 条架构红线](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/architecture/development-constraints.md)** (`architecture/development-constraints.md`)
  - 阐述 Kernel 五项检查、11 条不可触碰红线、唯一合法启动入口守卫（`run.sh`）与团队安全凭据红线。
- **[测试分层与因果验证规范](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/testing-specification.md)** (`testing-specification.md` / [测试规范.md](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/测试规范.md))
  - 阐述独立 Run 隔离装配测试、图分析工具耦合度检查指标（传入/传出耦合、不稳定度、死循环检测）、以实际可行结果可观测为成功指标的单元测试，以及因果查询链路追踪。
- **[子 Agent 并行开发契约与桌面排他守卫](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/subagent-parallel-contract.md)** (`subagent-parallel-contract.md` / [子Agent并行开发契约.md](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/子Agent并行开发契约.md))
  - 阐述多 Agent 命名 Run 沙箱隔离、端口与 Git 提交所有权分流，以及**微软 UFO 桌面自动化与 OS 步骤记录器的物理桌面绝对排他守卫（严禁并发抢桌面）**。

---

## 代码布局与使用指南对齐矩阵 (Packages Reference)

REFERENCE 目录结构与项目源码完全保持 1:1 对齐，并提供全量接口覆盖与开箱即用指南：

| 代码目录 | 引用文档目录 | 开箱即用定位与核心功能 | 核心语言 |
| :--- | :--- | :--- | :--- |
| [`packages/rust/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/rust) | [REFERENCE/packages/rust/](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/README.md) | **物理微内核与因果分析引擎**。<br>单飞因果调度黑盒、开箱即用常驻守护进程、死锁/中心性/社区拓扑分析。 | Rust |
| [`packages/contract/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/contract) | [REFERENCE/packages/contract/](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/contract/README.md) | **机器契约与协议全集**。<br>**无遗漏覆盖全部 26 项协议操作**、入参返回字段、标准化错误码字典与 Golden Frames 验证。 | JSON |
| [`packages/sdk/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/sdk) | [REFERENCE/packages/sdk/](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/sdk/README.md) | **多语言业务开发 SDK (TS & Python)**。<br>纯领域节点（Node）、物理执行/观察节点（WorldNode）、ChangeContext 全量方法与内存单测 Harness。 | TS / Python |
| [`packages/desktop/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/desktop) | [REFERENCE/packages/desktop/](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/desktop/README.md) | **Electron 桌面宿主与运行守卫**。<br>唯一合法启动命令（`run.sh`）、直接拉起阻断抛错守卫、Preload 安全网桥。 | TS / Electron |
| [`packages/frontend/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/frontend) | [REFERENCE/packages/frontend/](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/frontend/README.md) | **零业务工作台与达芬奇设计系统**。<br>全量 Client Hooks (`useNodeState`)、插件 UI 挂载 (`rendererRoots`) 与达芬奇 CSS Token 字典。 | React / CSS |
| [`packages/tooling/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/tooling) | [REFERENCE/packages/tooling/](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/tooling/README.md) | **工具链与全息因果可视化器**。<br>瑞士风 2D 可视化器、遥测服务端、`run.sh` 统一运维 CLI 与代码重构工具。 | Node / Web |
| [`packages/ufo/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/ufo) | [REFERENCE/packages/ufo/](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/ufo/README.md) | **Windows 桌面控制与 UFO 自动化**。<br>全屏屏幕巡检、UIA 键鼠操作、10 大交互指令、窗口最大化与全屏截图。 | Python / UIA |

---

## 官方核心插件能力矩阵 (Core Plugins Reference)

位于 [`app/plugins/*`](file:///c:/Users/kp157/Desktop/PM/GVSDK/app/plugins) 的官方核心插件，提供开箱即用的录制、自动化与拓扑编排能力。完整手册见 **[核心插件全景指南](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/README.md)**：

| 插件 ID | 引用文档 | 节点工厂 / 图工厂 | 核心覆盖节点类 | 前端宿主与 UI 挂载 | 开箱即用定位与能力 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`example.unified-recorder`** | [统一双源录制插件](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/unified-recorder.md) | `createUnifiedRecorder`<br>`createUnifiedRecorderGraph` | `UnifiedSessionNode`<br>`UnifiedCaptureNode`<br>`UnifiedObserverNode` | Electron Host + React UI<br>(`runs/main` 默认桌面) | **双源桌面/浏览器统一录制器**。<br>流式合流、MHT 截图解压落盘、高信噪比纯文字 `agent-transcript.md`。 |
| **`example.browser-recorder`** | [浏览器录制插件](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/browser-recorder.md) | `createBrowserRecorder`<br>`createBrowserRecorderGraph` | `RecordingSessionNode`<br>`BrowserCaptureNode`<br>`BrowserObserverNode` | Electron Host + React UI | **Playwright 原生录制器**。<br>支持 playwright-cli 管道与 Chrome 9343 CDP WebSocket 实时录制。 |
| **`example.os-recorder`** | [桌面步骤录制插件](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/os-recorder.md) | `createOsRecorder`<br>`createOsRecorderGraph` | `RecordingSessionNode`<br>`RecordingCaptureNode`<br>`RecordingObserverNode` | Electron Host + React UI | **Windows 全桌面步骤记录器**。<br>调用 PSR 生成 ZIP 归档，解析 XML/MHT 提取键鼠操作步骤与截图。 |
| **`example.ufo-computer-control`** | [UFO 计算机全控](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/ufo-computer-control.md) | `createUfoComputerControl`<br>`createUfoComputerControlGraph` | `UfoComputerSessionNode`<br>`UfoComputerExecutionNode`<br>`UfoComputerObservationNode` | 纯后端调度<br>(Info 驱动闭环) | **Microsoft UFO 计算机全控**。<br>桌面应用巡检、控件树遍历、原生点击/输入/滚轮/热键 10 大指令下发。 |
| **`demo.topology`** | [因果拓扑演示插件](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/demo-topology.md) | `createDemoTopology`<br>`createDemoTopologyGraph` | `OrdersNode`<br>`RouterNode`<br>`BillingNode`<br>`InventoryNode`<br>`LedgerNode`<br>`FraudNode` | Electron Host + React UI | **因果拓扑与动态节点挂接范例**。<br>多节点扇出扇入、事务回执流水线、运行期动态准入挂接 `FraudNode`。 |
| **`example.hello-counter`** | [计数器与诊断插件](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/plugins/hello-counter.md) | `createCounterNode`<br>(`defineNodeFactory`) | `CounterNode` | 离线自诊断命令行 | **微内核最小规约与自诊断范例**。<br>用于最小后端测试、单飞验证与静态因果拓扑离线验证。 |

---

## 冷启动与能力包分发中心 (Cold Start & Capability Distribution)

规范新环境从零初始化至独立 Run 正常拉起，以及业务能力确定性打包、验证、冲突预演与安全分发的完整闭环。完整指引见 **[冷启动与能力包分发规范总览](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/distribution/README.md)**：

| 专栏维度 | 权威文档链接 | 核心内容与实操焦点 |
| :--- | :--- | :--- |
| **冷启动与环境初始化** | [冷启动与首次开发环境初始化指南](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/distribution/cold-start.md) | 5 步硬性流程：Git Bash / Node / Rust 工具探测、锁文件安装与 Rust 原生绑定编译分发、双工程 TypeScript 静态检查、独立 `runs/<name>/` 沙箱建立、统一 `run.sh` 首次拉起与平稳停机。 |
| **能力包打包与实操** | [能力包打包、验证与安装规范](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/distribution/capability-packaging.md) | 统一三命令（`run.sh pack / verify / install`）、标准目录架构与 Manifest 契约、固定时间戳**确定性 ZIP 机制**、严禁凭据与缓存安全红线、沙箱**冲突预演与三选一解决准则**。 |
| **团队分发与架构契约** | [SDK、工作流与团队协作分发契约](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/distribution/distribution-contract.md) | **团队三层协作分发架构**（阿里云自建云主机知识库、独立 Run 场景分享、基础软件批量更新通道）、**非核心插件绝对不进入 `app/` 铁律**、Generation 因果断代破坏性更新语义、脱离源码树的**独立目录 7 步发布验收标准**。 |
