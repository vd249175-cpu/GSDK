# GraphFramework SDK 开发守则与 Agent 指引

本文档是本仓库中所有开发者与 Agent 的最高行为准则与任务导航中枢。

---

## 1. 核心开发原则与良好习惯

- **Git 小步提交与多做保存**：
  - 养成阶段性提交好习惯，小步快跑。每完成一个原子逻辑、重构或测试通过后，多用 Git 保存检查点（checkpoint）。
  - 提交前主动检查 `git status -s` 与 `git diff`，确保不引入无意变动的脏文件或未清理的临时文件。
  - 保证工作树随时处于干净、可追踪、随时可安全回滚的状态，严禁在脏工作区上堆叠多个不相关的大改动。
- **测试驱动与针对性验证**：
  - 修复缺陷或扩展能力时，先写最小复现用例或单测。
  - 排障优先验证最小局部，不无意义全量跑批；不启动黑盒开发服务器进行肉眼盲测。
- **确定性与整洁原则**：
  - 不使用 `node -e` 拼凑临时验证脚本。
  - 源码修改与文档更新同步进行，随时保持文档与实现一致。
- **重构治理与 LSP 优先**：
  - 在进行符号重命名、跳转分析、类型定义查找及重构操作时，严格优先使用 LSP 工具，确保重构在类型系统与语义层面的绝对安全与精确。
  - 跨文件重构或代码批量替换辅助使用 `node packages/tooling/refactor/refactor.mjs`。
- **严格类型检查**：
  - 任何代码修改必须通过 `npm --prefix packages/desktop run typecheck` 与 `npm --prefix packages/sdk/javascript run typecheck`。
- **文档维护规范**：
  - 当前文档只描述已存在的源码，不写迁移史和未来假想架构；
  - 示例必须使用当前 `@graphframework/*` 公开 API，严禁引用已废弃或不存在的文件/方法；
  - Markdown 文件遵循 OKF 0.2 知识包规范（必须包含合法的 `type` frontmatter）。

---

## 2. 事实裁决顺序

开始修改前必须先读 [核心心智模型](REFERENCE/architecture/mental-model.md)（备用：[DOCUMENTS/architecture/mental-model.md](DOCUMENTS/architecture/mental-model.md)）。信息冲突时按以下顺序判断：

```text
源码与针对性测试
  > REFERENCE/architecture/mental-model.md
  > REFERENCE/core-development-mode.md / workflow-development-mode.md
  > REFERENCE/packages/ / REFERENCE/plugins/ / REFERENCE/distribution/
  > DOCUMENTS/ 备用参考文档
```

本仓库不保存退役架构文档。出现 Socket Kernel、声明边、Wrapper、Transition Registry 或旧应用私有绑定等说法，应视为外部旧资料，不得据此改代码。生产调度内核唯一运行在 Rust 原生微内核（`packages/rust/kernel` 通过 `NativeRuleSpace`），旧 TS `KernelRuntime` 已降级为只读规约/测试 Oracle，不再维护双内核并行演进。

---

## 3. 架构红线 (Architecture Redlines)

1. `packages/sdk/javascript/src/node` 是零业务语义微内核规约与类型底座，生产调度由 Rust 原生微内核（`packages/rust/kernel` 经 `NativeRuleSpace`）统一承担；`packages/frontend/workbench/` 是零业务语义的前端工作台底座，不得导入具体业务插件。
2. Node 间通信只使用 `ctx.send(info, targetNodeId)`；不得增加 flows、Edge、Wrapper 或全局广播总线。
3. 每个 `ctx.send` 的 `Info.type` 必须能在当前 change 分支或发送点静态可证明。禁止把完整 Info 隐藏在不透明构造函数中；`unresolved-info-type` 是必须修复的校验错误。
4. State 只能由 Owner Node 在当前 `change ctx` 中写入；外部节点只能通过发送 Info 请求变迁。
5. 纯领域 Node 零 I/O、零系统 API。
6. **WorldNode 严格分为两类，观察和执行必须物理分离，不得混合**：
   - **执行类（`ExecutionWorldNode`）**：主动向物理系统下发动作、修改外部状态、提交任务并获取 handle。执行完成立即结算 change，零持续监听职责，不兼任轮询；
   - **观察类（`ObservationWorldNode`）**：监听物理世界事件、轮询任务状态或接收系统回调，将感知到的物理事实作为 Observation 封装为 Info。零主动外部写操作；
   - 物理动作只经构造注入的 `EffectAdapter` 执行。
7. Projection state 是 `EncodedValue`，读取必须经 `valueCodec.decode`；UI 业务事实只来自投影，不得在前端伪造第二份业务状态。
8. 所有业务均为平等插件；内置插件与第三方插件采用同一 Manifest、SDK、装载器和生命周期。
9. Node 执行异常必须在代码层面被安全捕获为一条特殊的 Info，具备同等因果流通权并可随意发送，严禁让未捕获异常击穿规则空间。
10. **Node generation 替换是刻意的破坏性因果断代**：只在单飞间隙执行，丢弃旧 mailbox backlog，以新实例初始 State 干净启动，并使旧租约失效。内核不得增加新版本失败自动回滚、State 自动继承/迁移、无缝切换或跨 generation 消息保留；这些行为会混淆版本间的 State 与 Info 契约，不是待补能力。
11. Git 拉取、目录发现、编译器与依赖定位、自动安装/构建、进程启动及文件监听属于可选外层宿主能力，不得下沉进 Rust 微内核。业务若需要数据恢复或发布编排，必须由显式 Info、业务 Node 或外层宿主完成。

---

## 4. 运行守卫与隔离原则 (Runtime Guardrails)

1. **唯一合法启动命令**：
   所有桌面应用、后端片段、微内核切片或场景测试，**唯一合法的运行入口**是根目录的 `run.sh`：
   ```bash
   bash ./run.sh start runs/<name>/run.config.json
   bash ./run.sh status runs/<name>/run.config.json
   bash ./run.sh stop runs/<name>/run.config.json
   ```
2. **严禁任何绕过统一 run 的旁路启动**：
   - 严禁通过 `npm start`、`npx electron`、写死 `new BrowserWindow` 的临时脚本等任何旁路手段直接拉起窗口或程序；
   - `packages/desktop/host/main.mjs` 中的 `throw new Error('Launch a configured run from the repository root: bash ./run.sh start runs/<name>/run.config.json');` 是强制架构守卫，严禁修改、绕过或伪造启动入口。
3. **便捷脚本纯委托原则**：
   - `runs/<name>/start.sh`、`stop.sh`、`status.sh` 与 Windows `.cmd` 脚本必须严格透传委托根目录 `run.sh`，绝对禁止在便捷脚本内编写旁路拉起逻辑。
4. **主 run 与开发 run 的划分与物理隔离**：
   - **唯一主 run（`runs/main/`）**：
     - **主 run 的名称固定为 `runs/main`**；
     - `runs/main` 是全仓唯一的正式集成与生产交付入口，装配已通过完整验收的正式能力与桌面工作台；
     - 严禁把未经验收的实验代码、开发中插件或临时配置直接写入 `runs/main`。
   - **开发/协作 run（`runs/<name>/`）**：
     - 每个开发者或 Agent 分配一个稳定不重复的名称（如 `runs/alice/`、`runs/bob/`），独占自己的 run 目录；
     - 开发与测试期间，新插件必须保持在 `runs/<name>/plugins/<plugin-id>/` 内隔离开发，严禁直接在全局共享目录 `app/plugins/` 下建未测试插件；
     - 同一工作树中的共享源码和 Git 索引必须明确所有权；目录隔离不能代替文件协调和串行集成提交。
   - **非核心插件不进入 `app/` 铁律**：
     - `app/` 与 `app/plugins/` 仅承载全仓最核心的底座与核心插件；
     - **所有非核心插件（业务流程、自动化策略、工作流专用节点）绝对不进入 `app/`**，只在 run 下的特定工作流中（开发阶段在 `runs/<name>/plugins/`）；
     - **先跑通测试再并入 main**：工作流分享以单个独立 run（包含配置、非核心插件集合与测试）为载体；接收方必须在独立 run 中先跑通测试，验证无误后，工作流可通过 `runs/main/plugins/` 并入主 run，但**非核心插件绝不进入核心 `app/`**。
5. **多子 Agent 并行开发与 UFO 桌面绝对排他铁律**：
   - 每个子 Agent 独占分配的 `runs/<subagent-id>/` 沙箱，微内核端口、Vite 端口与生成产物严格正交隔离，严禁并发全量暂存 Git；
   - **UFO 物理桌面强占冲突红线**：操作系统前台焦点、鼠标光标与全屏窗口为单一硬件独占资源。**微软 UFO 计算机控制（`example.ufo-computer-control`）与 Windows 步骤记录器（`example.os-recorder`）绝对严禁多 Agent 并发执行真机物理自动化（严禁抢桌面）**；
   - 并行期涉及 UFO 研发必须使用 `MockUfoEffectAdapter` 模拟单测进行逻辑分流；真机物理交互与录制必须获取系统级独占锁并严格串行执行。详见 [子 Agent 并行开发契约与桌面排他守卫](REFERENCE/subagent-parallel-contract.md)。

---

## 5. 团队安全与凭据红线 (Security Guardrails)

1. **凭据安全绝对红线**：
   - 任何账号授权均由员工本人在浏览器确认；
   - **严禁把应用密钥、access token、个人凭证或私钥写入仓库代码、`AGENTS.md`、run 配置或群聊**；
   - device code 只用于当次 split-flow 授权，不持久化或跨流程复用；
   - 若机器无团队应用凭证，不得编造密钥，由管理员提供安全配置或经员工明确同意后创建。
2. **环境与运行安全**：
   - Windows 必须提供可执行根目录 `run.sh` 的 Git Bash，不得写死他人路径，不得用 PowerShell、WSL 绕过统一 run；
   - 环境验收不等于启动应用；除非用户明确要求运行，严禁为了验证安装而旁路拉起 Electron 或桌面窗口。

---

## 6. 任务与知识库导航 (Repository Task Navigation)

遇到具体开发与维护任务时，直接跳转至对应的权威目标页。以 **[REFERENCE 总索引](REFERENCE/README.md)** 为权威正本，原 `DOCUMENTS/` 目录保留作为备用参考：

| 任务类型 | 权威目标入口 (新版 REFERENCE) | 决策与参考文档 (新版 REFERENCE) | 备用参考 (原 DOCUMENTS) |
| :--- | :--- | :--- | :--- |
| **首次环境与冷启动** | [冷启动与环境初始化](REFERENCE/distribution/cold-start.md) | [冷启动与打包分发总览](REFERENCE/distribution/README.md) | [第一次准备开发环境](DOCUMENTS/goals/first-setup.md) / [测试分层](DOCUMENTS/guides/testing.md) |
| **核心开发模式** | [核心开发模式指南](REFERENCE/core-development-mode.md) | [核心 Packages](REFERENCE/packages/README.md) / [核心 Plugins](REFERENCE/plugins/README.md) | [开发第一个业务功能](DOCUMENTS/goals/build-feature.md) / [Plugin SDK 指南](DOCUMENTS/guides/plugin-sdk-guide.md) |
| **工作流开发模式** | [工作流开发全景指南](REFERENCE/workflow/README.md) | [Agent 原生层级五级金字塔](REFERENCE/workflow/agent-native-hierarchy.md) / [引导带教](REFERENCE/workflow/guided-onboarding.md) | [应用开发指南](DOCUMENTS/guides/application-development.md) |
| **外部 I/O 与硬件接入** | [多语言 SDK (WorldNode / EffectAdapter)](REFERENCE/packages/sdk/README.md) | [UFO 计算机控制](REFERENCE/packages/ufo/README.md) / [统一录制器](REFERENCE/plugins/unified-recorder.md) | [接入外部世界](DOCUMENTS/goals/integrate-external-world.md) / [平台 SDK 心智模型](DOCUMENTS/architecture/sdk-mental-model.md) |
| **桌面界面与达芬奇交互** | [零业务工作台与 Client Hooks](REFERENCE/packages/frontend/README.md) | [前端规范与达芬奇色彩](REFERENCE/plugins/frontend-specification.md) | [增加桌面界面](DOCUMENTS/goals/build-ui.md) / [设计系统](DOCUMENTS/guides/design-system.md) |
| **运行与 8 步生命周期** | [冷启动与 8 步因果生命周期](REFERENCE/distribution/cold-start.md) | [桌面宿主与架构守卫](REFERENCE/packages/desktop/README.md) | [创建和运行独立 run](DOCUMENTS/goals/run-application.md) / [命名 run 生命周期](DOCUMENTS/architecture/application-lifecycle.md) |
| **测试与因果指标验证** | [测试规范与针对性验证](REFERENCE/testing-specification.md) | [图分析工具与因果链路追踪](REFERENCE/testing-specification.md) | [为改动补测试并提交](DOCUMENTS/goals/verify-change.md) / [测试分层](DOCUMENTS/guides/testing.md) |
| **因果断点与图健康排查** | [因果分析引擎与拓扑度量](REFERENCE/packages/rust/README.md) | [测试规范 (因果查询工具)](REFERENCE/testing-specification.md) | [排查因果链不推进](DOCUMENTS/goals/debug-causal-flow.md) / [Node 实例因果调试](DOCUMENTS/diagnostics/debug-guide.md) |
| **能力打包与分发** | [能力包打包、验证与安装规范](REFERENCE/distribution/capability-packaging.md) | [团队三层分发契约](REFERENCE/distribution/distribution-contract.md) | [打包、安装或更新能力](DOCUMENTS/goals/distribute-capability.md) / [分发契约](DOCUMENTS/contracts/distribution-contract.md) |
| **微内核能力演进** | [核心心智模型与 13 公理](REFERENCE/architecture/mental-model.md) | [开发准入约束与 11 红线](REFERENCE/architecture/development-constraints.md) / [Rust 物理微内核](REFERENCE/packages/rust/README.md) | [开发或开放内核能力](DOCUMENTS/goals/evolve-kernel.md) / [开发准入约束](DOCUMENTS/architecture/development-constraints.md) |
| **多语言与跨进程接入** | [机器契约与 23 协议操作全集](REFERENCE/packages/contract/README.md) | [Rust 常驻守护进程与 C ABI](REFERENCE/packages/rust/README.md) | [接入其他编程语言](DOCUMENTS/goals/add-language-runtime.md) / [常驻宿主协议](DOCUMENTS/protocols/kernel-daemon-protocol.md) |
| **子 Agent 并行与桌面排他** | [子 Agent 并行开发契约](REFERENCE/subagent-parallel-contract.md) | [UFO 计算机控制](REFERENCE/packages/ufo/README.md) / [统一录制器](REFERENCE/plugins/unified-recorder.md) | [多 Agent 协作指南](DOCUMENTS/contracts/multi-agent-run-guide.md) |
| **Agent 技能与 MCP 工具箱** | [技能与 MCP 工具箱全景规范](REFERENCE/workflow/skills-and-mcp-tooling.md) | [Playwright / 阿里云 Workbench / UFO](REFERENCE/workflow/skills-and-mcp-tooling.md) | [工作流开发全景指南](REFERENCE/workflow/README.md) |
