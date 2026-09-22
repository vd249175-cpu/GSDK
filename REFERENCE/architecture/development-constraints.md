---
type: Architecture Specification
title: 开发准入约束与架构红线 (development-constraints.md)
description: Kernel 五项准入检查、11 条架构不可触碰红线、运行守卫与安全准则。
status: stable
tags: [architecture, redlines, constraints, kernel-checks, guardrails]
---

# 开发准入约束与架构红线 (`development-constraints.md`)

在 GraphFramework 中进行任何新增代码、接口扩展或功能开发前，必须对照本文档执行准入审查。触犯本文档任何红线将被代码门禁与架构守卫坚决拒绝合并。

---

## 1. 准入必检：Kernel 五项检查 (Kernel Five-Check)

在新增任何 Node、字段、物理能力或内核改动前，必须自问以下五项问题：

1. **是否包含了业务语义？**
   - 若是：**坚决不得进入微内核**。必须放置于具体业务插件中。
2. **是否包含了物理 I/O 或系统 API？**
   - 若是：**坚决不得写入纯领域 Node**。必须下沉为物理 `EffectAdapter`，并仅由 `ExecutionWorldNode` 或 `ObservationWorldNode` 经构造注入调用。
3. **`Info.type` 是否在发送点静态可证明？**
   - 若否：**属于严重错误**。必须能够在 AST 层面或单飞分支中静态推导，严禁使用动态拼接或隐藏在黑盒构造函数中。
4. **State 写入是否遵循单一所有权？**
   - 若否：严禁让非 Owner 节点跨界写入，严禁全局变量修改。
5. **物理执行与观察是否混在同一个类中？**
   - 若是：**必须物理拆分为两个节点**。一个专职下发动作，一个专职接收事件。

---

## 2. 11 条绝对架构红线 (Architecture Redlines)

1. **Rust 原生微内核生产唯一**：
   - `packages/sdk/javascript/src/node` 是零业务语义微内核规约与类型底座；
   - 生产调度统一由 Rust 原生微内核（`packages/rust/kernel` 经 `NativeRuleSpace`）承担；
   - `packages/frontend/workbench/` 是零业务语义的前端工作台底座，不得导入具体业务插件。
2. **通信路径唯一**：
   - Node 间通信只使用 `ctx.send(info, targetNodeId)`；
   - 严禁增加 flows、Edge、Wrapper 或全局广播总线。
3. **静态可证明类型**：
   - 每个 `ctx.send` 的 `Info.type` 必须能在当前 change 分支或发送点静态可证明；
   - 禁止把完整 Info 隐藏在不透明构造函数中；`unresolved-info-type` 是必须修复的校验错误。
4. **严格单写者**：
   - State 只能由 Owner Node 在当前 `change ctx` 中写入；
   - 外部节点只能通过发送 Info 请求变迁。
5. **纯领域节点零物理污染**：
   - 纯领域 Node 零 I/O、零系统 API。
6. **世界节点物理分离铁律**：
   - **执行类（`ExecutionWorldNode`）**：主动向下发动作、修改外部状态、提交任务并获取 handle。执行完成立即结算 change，零持续监听职责，不兼任轮询；
   - **观察类（`ObservationWorldNode`）**：监听物理世界事件、轮询任务状态或接收系统回调，将感知到的物理事实作为 Observation 封装为 Info。零主动外部写操作；
   - 物理动作只经构造注入的 `EffectAdapter` 执行。
7. **投影单向只读**：
   - Projection state 是 `EncodedValue`，读取必须经 `valueCodec.decode`；
   - UI 业务事实只来自投影，不得在前端伪造第二份业务状态。
8. **平等插件架构**：
   - 所有业务均为平等插件；内置插件与第三方插件采用同一 Manifest、SDK、装载器和生命周期。
9. **异常因果同权**：
   - Node 执行异常必须在代码层面被安全捕获为一条特殊的 Info，具备同等因果流通权并可随意发送，严禁让未捕获异常击穿规则空间。
10. **破坏性断代不可逆**：
    - Node generation 替换是刻意的破坏性因果断代：只在单飞间隙执行，丢弃旧 mailbox backlog，以新实例初始 State 干净启动，并使旧租约失效；
    - 内核不得增加新版本失败自动回滚、State 自动继承/迁移、无缝切换或跨 generation 消息保留。
11. **宿主外层职责不得下沉**：
    - Git 拉取、目录发现、编译器与依赖定位、自动安装/构建、进程启动及文件监听属于可选外层宿主能力，不得下沉进 Rust 微内核。

---

## 3. 运行守卫与隔离原则 (Runtime Guardrails)

1. **唯一合法启动命令**：
   - 所有桌面应用、后端片段、微内核切片或场景测试，**唯一合法的运行入口**是根目录的 `run.sh`：
     ```bash
     bash ./run.sh start runs/<name>/run.config.json
     bash ./run.sh status runs/<name>/run.config.json
     bash ./run.sh stop runs/<name>/run.config.json
     ```
2. **严禁旁路启动**：
   - 严禁通过 `npm start`、`npx electron` 或临时脚本绕过 `run.sh` 直接拉起窗口。
3. **主 run 与开发 run 的划分与物理隔离**：
   - **唯一主 run（`runs/main/`）**：全仓唯一的正式集成与生产交付入口，装配已通过完整验收的正式能力与桌面工作台；严禁把未经验收的实验代码直接写入 `runs/main`。
   - **开发/协作 run（`runs/<name>/`）**：每个开发者或 Agent 独占自己的 run 目录（如 `runs/alice/`、`runs/bob/`）。
4. **非核心插件不进入 `app/` 铁律**：
   - `app/` 与 `app/plugins/` 仅承载全仓最核心的底座与核心插件；
   - **所有非核心插件（业务流程、自动化策略、工作流专用节点）绝对不进入 `app/`**，只在 run 下的特定工作流中（开发阶段在 `runs/<name>/plugins/`）；
   - **先跑通测试再并入 main**：工作流必须先在独立 run 中跑通单测与集成测试，验证无误后方可通过 `runs/main/plugins/` 并入主 run。

---

## 4. 凭据安全红线 (Security Guardrails)

1. **凭据安全绝对红线**：
   - **严禁把应用密钥、access token、个人凭证或私钥写入仓库代码、文档、run 配置或日志中**；
   - device code 只用于当次授权，不持久化或跨流程复用；
   - 任何账号授权均由员工本人在浏览器中确认。
