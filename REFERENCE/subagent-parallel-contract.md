---
type: Contract
title: 子 Agent 并行开发契约与桌面排他守卫
description: 规定多子 Agent 并行开发时的命名 Run 沙箱隔离、端口与 Git 所有权分流，以及微软 UFO 桌面自动化与 OS 步骤记录器的物理桌面独占排他（严禁并发抢桌面）硬性契约。
status: stable
tags: [subagent, parallel-development, ufo, desktop-exclusive, isolation, guardrails]
---

# 子 Agent 并行开发契约与桌面排他守卫

在 GraphFramework 体系中，当主 Agent 协调多个子 Agent（Sub-Agents）协同进行代码开发、工作流录制分析、前端组件搭建与单测验证时，必须遵循严格的**物理隔离、资源分流与排他竞争守卫**。

本契约特别针对“**微软 UFO 计算机全控**”与“**OS 步骤记录器**”等物理桌面级自动化能力制定了绝对排他红线，坚决杜绝因多 Agent 并发导致的“抢桌面”破坏事故。

---

## 1. 核心协作架构：命名 Run 沙箱隔离

每个子 Agent 的开发活动必须严格限制在分配给自己的独立 Run 目录中，严禁跨沙箱操作：

```text
runs/
├── main/                 <- 正式集成生产入口 (所有 Agent 严禁直接写入未经验收代码)
├── subagent-alice/       <- 子 Agent Alice 独占沙箱 (独立端口、独立内核、独立插件)
│   ├── run.config.json
│   ├── assembly.mjs
│   ├── plugins/          <- 自身开发的非核心插件
│   └── .generated/       <- 独占的进程锁、凭证、日志与数据
└── subagent-bob/         <- 子 Agent Bob 独占沙箱 (与 Alice 物理正交隔离)
```

### 沙箱隔离五大铁律

1. **独占命名 Run**：协调者为主/子 Agent 分配互不重复的沙箱名称（如 `runs/subagent-data/`、`runs/subagent-ui/`），分配后稳定使用；
2. **端口物理正交**：微内核端口（`kernel.daemon`）、前端 Vite 端口、Electron 调试端口必须分配不同端口号，禁止端口碰撞；
3. **运行时产物绝不共享**：`.generated/` 内部的进程身份、端点凭证、日志、缓存以及 `run.lock.json` 严格独占；
4. **Git 工作树所有权明确**：
   - 目录隔离不能代替 Git 索引隔离。同一个 Git 工作树中，严禁子 Agent 执行 `git add -A` 或全量 `git commit`；
   - 每个子 Agent 只能暂存和修改其职责路径下的文件，由主协调者统一集成提交；
5. **非核心插件绝不进入 `app/`**：子 Agent 开发的任何业务流程或自动化插件，只能留在自己的 `runs/<name>/plugins/` 内。

---

## 2. 并行安全能力矩阵（可并行 vs 严禁并行）

在 GraphFramework 中，不同类型的模块具有完全不同的物理并发特性：

| 研发/测试模块 | 并发等级 | 物理特性与约束规则 |
| :--- | :--- | :--- |
| **纯领域 Node / 状态机 / 算法** | **✅ 完全安全并行** | 零系统 I/O，微内核单飞调度，各沙箱内存完全隔离。 |
| **达芬奇前端面板 (DaVinci UI)** | **✅ 安全并行** | 独立 Vite 端口，独立 Electron 用户数据目录与窗口实例，无 DOM 冲突。 |
| **浏览器自动化与录制 (Browser CDP)** | **⚠️ 受控并行** | 必须分配不同的 CDP 调试端口（如 9343、9344）与独立的浏览器 UserData 目录；推荐 Headless 模式。 |
| **UFO 计算机控制 (`ufo-computer-control`)** | **💥 绝对严禁并行 (Strictly Serialized)** | **物理桌面强独占资源**：操作系统仅有唯一的物理桌面窗口管理器、单一前台焦点、单个鼠标指针。多 Agent 并发必抢桌面！ |
| **OS 步骤记录器 (`os-recorder`)** | **💥 绝对严禁并行 (Strictly Serialized)** | 截屏与 Windows 全局键盘/鼠标输入钩子全局唯一，并发必互相污染。 |
| **微内核原生编译 (`cargo build`)** | **⚠️ 串行排他** | 避免对 `target/` 目录与 `.node` 产物进行并发编译写入。 |

---

## 3. UFO 计算机控制“抢桌面”危害与排他契约

### 3.1 什么是“抢桌面”灾难？

微软 UFO 计算机控制是通过 Windows UIA（UI Automation）、物理光标移动、真实鼠标点击、全屏截图与全局键盘发送等物理动作来驱动桌面程序的：

> [!CAUTION]
> **物理桌面竞争危害**：
> 1. **鼠标指针打架**：Agent A 正在点击“确定”按钮，Agent B 突然把鼠标强行移动到屏幕左上角，导致 Agent A 误触错误按钮或点到危险区域；
> 2. **前台窗口焦点跳动**：Agent A 正在向输入框键入密码或命令，Agent B 拉起或置顶了另一个窗口，导致 Agent A 的按键全部击穿输入到错误窗口；
> 3. **全屏巡检与视觉污染**：UFO 截图需要当前窗口处于正常可视且未遮挡状态。并发运行会导致截图截到另一个 Agent 的面板或弹窗，导致视觉感知和 UIA 节点解析彻底失效。

### 3.2 UFO 模块并行开发“分流两步法”

为了在多 Agent 协同体系中既保证开发效率，又绝对避免抢桌面，必须严格执行**逻辑层并行与物理层串行两步法**：

```text
【第一阶段：逻辑与契约开发 —— 允许并行】
  - 编写 UFO 专属 Node（SessionNode, ExecutionNode, ObservationNode）
  - 编写 Info 与 Observation 数据结构
  - 构造内存 mock EffectAdapter（在内存中模拟 UIA 返回与点击成功回执，见 app/plugins/backend/ufo-computer-control/tests/backend.test.mjs 的 assemble() 模式）
  - 在独立 Run 中运行单测与逻辑闭环验证
      │
      ▼
【第二阶段：真机物理联调与录制 —— 绝对串行独占】
  - 必须获取桌面独占锁（同一物理机同一时刻只允许一个 Agent 执行真实桌面操作）
  - 最小真机交互验证（执行完立即释放桌面焦点，不长期霸占）
  - 严禁任何后台未经通知的物理键鼠注入！
```

---

## 4. 冲突预防与应急处理机制

### 4.1 预防机制：桌面操作互斥声明

在拉起涉及 UFO 或 OS 步骤记录器的 Run 之前，Agent 必须检查：
1. 本地是否有其他处于活动状态的桌面自动化进程（`python.exe` 驱动 UFO、`psr.exe`、自动化测试浏览器）；
2. 执行 `bash ./run.sh status <other-run>`，确认他人 run 是否开启了桌面控制适配器；
3. 若已有活动桌面操作，**必须等待其完全停机释放，严禁并发拉起**。

### 4.2 应急止损：失控抢桌面时的自救命令

若在开发过程中发现鼠标剧烈抖动、窗口疯狂跳动或出现非本任务操作：

```bash
# 1. 立即停止自己的 run (释放微内核与宿主)
bash ./run.sh stop runs/<your-name>/run.config.json

# 2. 强行终止残留的 UFO Python 进程与 PSR 步骤记录器进程 (Windows Git Bash)
taskkill //F //IM python.exe //FI "WINDOWTITLE eq UFO*" 2>/dev/null || true
taskkill //F //IM psr.exe 2>/dev/null || true

# 3. 恢复物理桌面正常控制
```

---

## 5. 子 Agent 交付与收尾契约

子 Agent 完成分配的任务片段后，交付必须满足以下收尾验收项：

1. **彻底清理与关停**：
   - 执行 `bash ./run.sh stop runs/<name>/run.config.json`，确保无残留的后台进程或挂起的 Rust 内核；
   - 释放所有临时锁与端口占用；
2. **纯净交付清单**：
   - 交付变更文件清单（仅限自己沙箱目录或明确分配的共享文件）；
   - 严禁提交 `.generated/`、日志、凭证或临时截图；
3. **单测先行证据**：
   - 提供在自身 run 沙箱内跑通的针对性单测日志与因果链追踪证据；
4. **协调者统一合并**：
   - 由主 Agent / 协调者审查代码并串行并入集成分支或 `runs/main`，子 Agent 绝不擅自全量覆盖主 run。

---

## 相关权威链接

- [核心心智模型与架构红线](architecture/mental-model.md)
- [UFO 计算机控制规范](packages/ufo/README.md)
- [多 Agent 运行协作备用参考](../DOCUMENTS/contracts/multi-agent-run-guide.md)
- [测试规范与针对性验证](testing-specification.md)
