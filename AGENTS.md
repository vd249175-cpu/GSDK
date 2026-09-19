# GraphFramework SDK 开发守则

## 1. 良好开发习惯

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

## 2. 事实顺序

开始修改前必须先读 `DOCUMENTS/architecture/mental-model.md`。信息冲突时按以下顺序判断：

```text
源码与针对性测试
  > DOCUMENTS/architecture/mental-model.md
  > DOCUMENTS/architecture/sdk-mental-model.md
  > DOCUMENTS/guides/kernel-sdk-guide.md / plugin-sdk-guide.md / client-sdk-guide.md
  > 其他当前文档
```

本仓库不保存退役架构文档。出现 Socket Kernel、声明边、Wrapper、Transition Registry 或旧应用私有绑定等说法，应视为外部旧资料，不得据此改代码。生产调度内核唯一运行在 Rust 原生调度器（`packages/rust/kernel` 通过 `NativeRuleSpace`），旧 TS `KernelRuntime` 已降级为只读规约/测试 Oracle，不再维护双内核并行演进。

## 3. 架构红线

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

## 4. 标准排障流程

1. 确认目标 Node ID、State Owner 和物理隔离边界。
2. 沿 `Info → change → State → send/effect → Projection` 定位断点，查清因果推进在哪一步中断或异常。
3. 验证单 Node 行为优先使用 `@graphframework/sdk/testing` 的 `createTestRuntime`，通过 mock Adapter 和 `waitForQuiescence()` 验证确定性收敛。
4. 将修复固化为针对性单元测试，再执行全套静态与类型检查。

## 5. 修改后的验证与重构规范

- **针对性测试**：只跑与修改直接相关的 Vitest，使用 `--silent`。
- **类型检查**：代码修改必须通过 `npm --prefix packages/desktop run typecheck` 与 `npm --prefix packages/sdk/javascript run typecheck`。
- **重构治理与 LSP 优先**：
  - **优先使用 LSP 工具**：在进行符号重命名、跳转分析、类型定义查找及重构操作时，严格优先使用 LSP 工具，确保重构在类型系统与语义层面的绝对安全与精确。
  - 跨文件重构或代码批量替换辅助使用 `node packages/tooling/refactor/refactor.mjs`。
- 不无意义运行全量测试，不使用 `node -e` 临时拼凑验证。

## 6. 文档维护

- 当前文档只描述已存在的源码，不写迁移史和未来假想架构。
- 文档示例必须使用当前 `@graphframework/*` 公开 API，严禁引用已废弃或不存在的文件/方法。
- Markdown 文件遵循 OKF 0.2 知识包规范（必须包含合法的 `type` frontmatter）。

## 7. 多 Agent 与统一 run 的目标约定

- 涉及并行开发、运行入口或宿主装配时，先读 [多 Agent 协作指南](DOCUMENTS/contracts/multi-agent-run-guide.md) 和 [统一 run 实施计划](DOCUMENTS/contracts/unified-run-plan.md)。Bash `run.sh start/stop/status`、v2 配置与完整 Studio run 已实现；验收差距以实施计划和源码测试为准。
- 为每个 Agent 分配任意且不重复的稳定名称及 `runs/<name>/`，独立配置前端、后端、权威图运行时和物理资源；运行范围可为任意片段、完整插件或全部程序，不以插件为运行单位。
- 目标入口由 Bash 显式读取本 run 配置，完整提供启动和关闭。整个 Studio 必须迁入同一 run 机制，不能只增加测试入口或用 Bash 包装旧 Electron 自启动方式宣称完成。
- 同一工作树中的共享源码和 Git 索引必须明确所有权；目录隔离不能代替文件协调和串行集成提交。

## 8. 唯一合法启动方式与运行红线

1. **唯一合法启动命令**：
   所有桌面应用、后端片段、微内核切片或场景测试，**唯一合法的运行入口**是根目录的 `run.sh`：
   ```bash
   bash ./run.sh start runs/<name>/run.config.json
   bash ./run.sh status runs/<name>/run.config.json
   bash ./run.sh stop runs/<name>/run.config.json
   ```
2. **严禁任何绕过统一 run 的旁路启动**：
   - 严禁通过 `npm start`、`npx electron`、写死 `new BrowserWindow` 的临时脚本等任何旁路手段直接拉起窗口或程序。
   - `packages/desktop/host/main.mjs` 中的 `throw new Error('Launch a configured run from the repository root: bash ./run.sh start runs/<name>/run.config.json');` 是强制架构守卫，严禁修改、绕过或伪造启动入口。
3. **正确启动的因果推进全链路（由 `supervisor.sh` 统一编排）**：
   - **Step 1 配置校验与锁获取**：原子占用目标 run 的 `run.lock`，生成本运行独占的环境凭据。
   - **Step 2 独占 Rust 微内核拉起**：启动本 run 独占的 `kernel-daemon` 进程（持有权威 State 与调度），等待 RPC 探针就绪。
   - **Step 3 后端 Node 宿主就绪**：启动后端 Node 进程，声明并准入图实例（Node），认领物理 EffectAdapter。
   - **Step 4 前端构建（`buildRunFrontends`）**：若包含 `frontend.instances`，通过 Vite 构建 React/达芬奇样式产物至 `.generated/frontend/<id>/dist/`，通过 esbuild 打包前端宿主至 `.generated/frontend/<id>/host.mjs`。
   - **Step 5 桌面宿主拉起**：由 Bash supervisor 调用平台 Electron 二进制执行前端 `host.mjs`，注入 `context.json`。
   - **Step 6 受控通讯与达芬奇界面渲染**：Electron 前端通过 `connectFrontendHost` 注册控制接口，建立与 Rust daemon 的只读投影缓存订阅与受限根 Info 注入，窗口加载并渲染达芬奇 UI。
   - **Step 7 界面布局与业务就绪**：supervisor 验证前端 `health` 与 `ready`（确认工作区面板具有可见几何布局），完成初始化与启动 Info 结算，正式进入运行态。
   - **Step 8 对称平稳停机**：任何退出均须通过 `run.sh stop` 触发（前端入站门禁关闭 → 业务在途与数据保存 → 停止物理观察源 → 推出节点与释放租约 → 关闭内核 → 关闭 Electron 与后端进程）。
4. **每个 run 目录下的人类一键启停脚本约定**：
   为了方便人类开发者日常使用与一键操作，每个 `runs/<name>/` 目录下均应配备专属的一键启动与关闭便捷脚本：
   - **Bash / 跨平台一键脚本**：`runs/<name>/start.sh` 与 `runs/<name>/stop.sh`（以及可选的 `status.sh`）；
   - **Windows 一键脚本**：`runs/<name>/start.cmd` 与 `runs/<name>/stop.cmd`（以及可选的 `status.cmd`），方便 Windows 环境下直接双击或在命令行运行；
   - **纯委托原则**：这些便捷脚本在实现上必须严格透传委托根目录唯一的规范入口（例如 `bash "$REPO_ROOT/run.sh" start "$CONFIG" "$@"`），绝对禁止在便捷脚本内编写旁路拉起逻辑或绕过 supervisor 编排。

## 9. 新成员开发环境与飞书初始化

当用户明确要求初始化新员工电脑，或首次进入一个尚未准备好的工作区时，Agent 应主动完成下列检查和安装协助。先检查、后安装；已有兼容工具不得无故升级或覆盖。任何账号授权均由员工本人在浏览器确认，禁止把应用密钥、access token 或个人凭证写入仓库、`AGENTS.md`、run 配置或群聊；device code 只用于当次 split-flow 授权，不持久化或跨流程复用。

### 9.1 基础环境探测

先在仓库根目录检查：

```bash
git --version
bash --version
node --version
npm --version
cargo --version
rustc --version
```

- Windows 必须提供可执行根目录 `run.sh` 的 Git Bash；如果 Git 已安装但 `bash` 不在 `PATH`，先定位 Git for Windows 的实际 `bin` 目录并追加到当前用户 `PATH`，再重新检查，不得写死另一位员工的路径。不得用 PowerShell、WSL 或临时 Node 脚本绕过统一 run。
- 缺少 Git Bash、Node.js/npm 或 Rust 工具链时，Agent 应说明用途并协助安装官方稳定发行版；安装完成后重新执行版本检查。
- 不在根目录假设存在统一 npm workspace。依赖按实际包目录安装。

### 9.2 仓库依赖与首次构建

新工作区使用锁文件安装依赖并构建当前平台原生绑定：

```bash
npm --prefix packages/sdk/javascript ci
npm --prefix packages/desktop ci
cargo build --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-node
node packages/rust/scripts/stage-native.mjs
node packages/rust/scripts/stage-backend-native.mjs
npm --prefix packages/desktop run build
```

已有工作区只有在 lockfile 已确认且不会覆盖他人未保存环境时才重跑 `npm ci`。其它工具包依赖按实际任务安装，不做无意义的全仓安装。初始化后至少执行：

```bash
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
node packages/tooling/run/src/cli.mjs validate runs/demo/run.config.json
```

环境验收不等于启动应用；除非用户明确要求运行，禁止为了验证安装而旁路拉起 Electron 或桌面窗口。

### 9.3 飞书 CLI、Skills 与用户身份

飞书承担知识库、工作流正文和能力 ZIP 分享。若 `lark-cli` 或项目内飞书 Skills 尚未安装，在仓库根目录执行官方安装流程：

```bash
npm install -g @larksuite/cli
npx -y skills add https://open.feishu.cn --skill -y
```

Windows 若仍找不到 `lark-cli`，先用 `npm prefix --global` 取得实际全局目录，只把该目录追加到当前用户 `PATH`，不得写死另一位员工的用户目录。随后验证 `lark-cli --version`。

认证与权限操作必须遵守安装后的 `lark-shared` Skill。团队目标身份为 `user-default`，因为成员需要以本人身份维护知识库、访问云盘并在群聊分享文件；绑定前仍须向员工说明 user 身份可以代表其访问这些资源并取得明确确认。优先绑定团队已配置的应用；Hermes 环境可使用：

```bash
lark-cli config bind --source hermes --identity user-default
```

如果机器没有团队应用凭证，不得编造或把密钥写入仓库；由管理员提供安全配置，或在员工明确同意创建独立应用后运行 `lark-cli config init --new`。若 CLI 因当前处于 Agent 环境而拒绝创建，只有在员工再次确认确实需要独立应用时才追加 `--force-init`。用户授权只申请当前协作需要的范围：

```bash
lark-cli auth login --domain wiki --domain docs --domain drive --domain im --no-wait --json
```

Agent 必须把命令返回的原始授权 URL 与 `lark-cli auth qrcode` 生成的二维码一起交给员工；员工确认完成后，由 Agent 使用本次 device code 完成登录，不让员工手工执行后续轮询。最终使用 `lark-cli auth status --json --verify` 验证 `identity: user`、`verified: true` 和有效 user token。

飞书 Skills、个人 `AGENTS.md` 页面索引与认证状态属于成员上下文层，不得进入基础软件更新包或工作流能力 ZIP，也不得在普通代码提交中顺手全量暂存。工作流正文仍只维护在飞书知识库中，不复制为 Workflow Skill。

### 9.4 初始化完成条件

新成员环境只有在以下条件全部满足后才算完成：基础命令可用；依赖安装和原生绑定构建成功；两套 TypeScript 类型检查通过；demo run 配置校验通过；飞书 user 身份可用；员工已获得自己的稳定 `runs/<name>/`；其个人 `AGENTS.md` 已按职责加入被授权的飞书知识库页面索引，但未复制工作流正文或任何凭证。


