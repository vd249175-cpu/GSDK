---
type: plan
title: 统一 run 实施计划
status: proposed
---

# 统一 run 实施计划

本文规定待实施的模块、步骤和验收，运行入口尚未交付。目录与协作约定见[多 Agent 协作指南](./multi-agent-run-guide.md)；源码现状见[心智模型](./mental-model.md)。新增路径、配置字段和 Bash 命令均为目标设计，不是现有公开 API。

## 1. 交付目标

根目录提供 Bash `run.sh`，以显式配置启动和关闭一个命名 run。任意名称由协调者分配给 Agent，分配后稳定使用，不为每次启动生成新的实例目录。

每个 run 有独立配置、前端、后端宿主、Rust 规则空间、可写产物和物理资源。配置可装配单节点、插件片段、完整插件、跨插件组合或全部程序。插件是源码归属和发布边界，不是运行单位。

正常运行和场景测试共用配置解析、构建、装配、初始化、启动及关闭；场景只增加输入、断言和结束条件。整个 Studio 必须通过同一 run 正常运行，最终移除旧应用启动链路。只包装 npm start、只支持 Agent 测试或只替换文档入口均不算完成。

采用现有 Rust daemon 承载独立内核进程，复用唯一 Rust 调度 crate。生产不新增 TS 调度器，同一 run 不同时维护 N-API 图和 daemon 图的两份权威 State。根目录不新增 npm workspace，各包保留独立依赖管理。

## 2. 目标目录和入口

```text
GVSDK/
├─ run.sh
├─ packages/tooling/run/          # 通用编排、配置和控制工具
├─ packages/{rust,sdk,desktop,frontend}/
├─ app/plugins/                   # 既有插件源码
└─ runs/<任意名称>/
   ├─ run.config.json
   ├─ plugins/                    # 本 Agent 开发的普通插件，可选
   ├─ frontend/                   # 前端装配，可选
   ├─ backend/                    # 宿主与 Adapter 装配
   ├─ graph/                      # 实例集合和初始化、启停输入
   ├─ scenarios/                  # 输入与断言，可选
   └─ .generated/
      ├─ frontend/
      ├─ backend/
      ├─ runtime/                 # 进程身份、端点、控制凭证、配置快照
      ├─ data/
      └─ logs/                    # 日志、场景报告和退出结果
```

目标命令：

```bash
bash ./run.sh start runs/alice/run.config.json
bash ./run.sh status runs/alice/run.config.json
bash ./run.sh stop runs/alice/run.config.json
```

配置有场景时，start 在同一运行上执行场景并自动关闭；无场景时维持正常交互。另设明确 force-stop，不作为正常退出的默认兜底。前后端入口可引用共用模块，无前端片段不启动窗口。完整程序的 run 名称由协调者选择，不在工具中硬编码。

## 3. 职责边界

| 部分 | 职责 | 不得代替的职责 |
| --- | --- | --- |
| Bash 入口及分层脚本 | 启动进程、编排阶段、等待结果和清理 | 不执行业务 change，不假定业务已保存 |
| 配置、控制和发现工具 | 解析 DTO、记录身份、合并控制请求 | 不隐式创建内核或装配整个应用 |
| Rust daemon | 调度、submission、generation、权威 State、shutdown | 不承担目录、构建、业务或本地 Node dispose |
| 后端 Node worker | 执行真实 Node，确认本地生命周期 | 不另持权威 State，不默认 admit 全图 |
| Effect provider / 观察宿主 | 注入物理能力，执行或观察外部世界 | 不越过 Owner 写 State，观察与执行分离 |
| 前端宿主 | 固定用户命令、Projection 绑定和窗口能力 | 不因关闭视窗杀内核，不取得任意控制权限 |
| 场景执行器 | 输入、断言、结束条件和报告 | 不复制业务逻辑，不另建测试专用生产图 |

内核启停、节点准入/推出、Info 注入分别提供独立操作，run.sh 组合它们。专用工具可处理结构化协议，不能重新成为隐式 JS 应用启动器。

## 4. 依赖和里程碑

| 编号 | 工作包 | 依赖 | 交付 |
| --- | --- | --- | --- |
| P0 | 运行契约与迁移差异 | 无 | 最小协议、迁出清单和验证用例 |
| P1 | 配置和资源隔离 | P0 | 两个任意命名 run 的独立配置、产物 |
| P2 | 真实 Node 的 daemon 桥接 | P0、P1 | 最小片段独立装配、结算和清理 |
| P3 | Bash 对称启停 | P1、P2 | 另终端 stop、重启及故障控制 |
| P4 | 独立前端、后端和投影 | P3 | 两个有前端 run 并行运行 |
| P5 | 同一 run 的场景测试 | P3，UI 场景依赖 P4 | 交互和自动测试共用生命周期 |
| P6 | 完整 Studio 切换 | P4、P5 | 整程序新入口和旧路径移除 |
| P7 | 多 Agent 演练和文档收敛 | P6 | 整程序与两个 Agent run 并行验收 |

M1：P1–P3 完成，任意最小片段可启动、停止、重启。M2：P4–P5 完成，独立前后端与场景共用运行。M3：P6–P7 完成，整程序替换与多 Agent 协作交付。只有 M3 达成才标记计划完成。

## 5. P0：确定最小契约和迁移差异

**修改范围：**先形成配置、公开实例工厂、后端控制、前端绑定、场景及清理确认契约，检查现有 Node/Effect worker、NativeRuleSpace 和 Studio 生命周期源码。

**任务：**

1. 分类硬编码：进程、目录、端口和凭证进入宿主参数；实例身份、目标绑定和 Adapter 进入构造装配；业务初始事实进入初始化 Info。
2. 明确宿主可装配、worker/provider 可执行、初始化结算、业务就绪和关闭完成的独立确认。通用工具不要求 Studio 生命周期 Node 存在，不硬编码业务 Info。
3. 核对 NativeRuleSpace 即时写入与 daemon 本地快照/有序 commit 的差异，明确异常、取消和断连时已接受 State/send 的保留语义，不能引入隐式回滚。
4. 核对 send 反馈、effectAdapter、Clock、AbortSignal、span、EncodedValue 和 WorldNode 权限。现有 daemon handler Context 不能被假定与 Node Context 完全等价。
5. 明确 daemon evict 与 worker dispose 的外层握手；delivery、handler、Effect 和本地清理分别确认。
6. 首先验证 Windows Git Bash 调用本机 Rust/Node/Electron、空格路径、信号和进程身份；WSL 与其他平台独立验收，不混用路径和信号假设。

**验证/出口：**每项差异都有最小用例及明确协议决定。不能以 Context 强制类型转换或旧 TS Oracle 代替兼容性验证。

## 6. P1：运行配置和独立输出

**修改范围：**新增 tooling/run 配置、路径与输出工具、run 模板；修改 .gitignore、desktop application 参数、main 构建、Vite 输出/缓存和插件入口定位。

**任务：**

1. 定义版本化 run.config.json，分开内核、前后端、实例集合、初始化/启停输入、等待条件、资源和可选场景。配置引用受信任模块，不 eval JSON 或拼接任意 shell 代码。
2. 相对路径以配置文件目录解析，配置位置确定 run 资源根；不额外声明矛盾的全局名称。保存已解析活动配置和引用版本，当前运行的 stop 使用活动快照。
3. 启动物理进程前完成静态可完成的身份、模块、实例声明和切口校验；构造后验证实际 ID 唯一性及事实，再 admit。
4. 所有可写产物和缓存进入本 run 的 .generated，不向源码旁写 backend.js 或 desktop JS，不覆盖其他运行加载中的共用原生制品。
5. 数据和用户目录默认独立，真实项目及外部共享资源显式指定。stop 保留数据，产物清理和删除业务数据分成不同操作。

**先写验证：**任意名称、其他 cwd、空格路径、外部插件目录、版本错误、缺失入口、重复实例声明和无前端/无场景配置；并行构建两个 run，检查源码与缓存无交叉改写。

**出口：**同一配置从不同 cwd 解析一致；非法输入在获得资源前失败；两个 run 独立构建；根目录仍无 npm workspace。

## 7. P2：真实 Node、Effect 和生命周期桥接

**修改范围：**JS SDK 的 node/daemon-node.ts、native-node.ts、effect/daemon-effect.ts、agent/daemon-client.ts 和生命周期桥接；必要的 Rust daemon、共同协议和 Python 镜像；Studio 公开实例工厂。

**任务：**

1. 直接复用真实 Node 的 change 与初始 State，补齐 P0 Context 语义，不能复制 handler 或回读 Node 实例内旧 State。
2. Adapter 经 provider/宿主注入，物理结果通过 Observation Info 回 Owner；取消和时钟在外层传递，领域 Node 保持零 I/O。
3. 完整范围可调用完整插件工厂；片段通过公开实例工厂直接构造选择范围，不能先创建整图再过滤。外部正式插件不导入私有实现。
4. 宿主先报告可装配，admit 后 worker 才 claim，worker/provider 确认可执行后才注入初始化，避免空内核阶段 claim 不存在的节点。
5. 提供 onMount 失败清理、密封、handler/Effect 结算、evict、租约释放及幂等 dispose 确认；控制连接与长轮询连接分开。
6. 明确切口参与者、Collector 或预期 dropped Info；初始化先于启动。Info.type 和实际目标证据可证明，不增加全局路由总线，不把 Node ID、物理路径和函数塞进业务 State。
7. 保持 generation 的破坏性断代，不自动迁移 State、重放旧消息或失败回滚。协议若需扩展，保持业务无关并同步共同契约与镜像。

**先写验证：**State/send 及反馈、错误 Info、Effect 成功/失败/取消、断连和迟到 Context；部分 mount 失败、挂起 handler、disposer 报错、重复清理和旧租约。跨语言协议用共同黄金帧验收。

**出口：**最小真实片段和跨插件组合运行成功；未选节点未构造；单一权威 State；本地清理可被确认。

## 8. P3：Bash 对称启停和控制记录

**修改范围：**根 run.sh、tooling/run 的 kernel、host、topology、info、verify 脚本以及持久控制/身份记录工具。Bash 为过程入口，控制组件接收请求和记录资源，不把启停交回业务 Electron main。

**启动任务：**校验配置并原子取得本 run 锁；准备产物；启动空 Rust 内核并等待端点；启动前后端宿主并确认可装配；admit 节点；等待 worker/provider；初始化并结算；注入启动 Info 并等待业务就绪。成功不靠固定 sleep 判断。

**关闭任务：**限制新业务但保留控制与必要 Observation；注入关闭 Info；等待业务准备、在途工作及保存；停止观察来源；推出并确认 handler/Effect/租约/dispose；关闭空 Rust 内核并等待进程退出；停止宿主及服务；记录结果并释放运行锁。

**控制任务：**

1. start/stop/status 记录进程身份、端点、控制凭证、配置快照和已完成阶段，不能只保存 PID。不同名称互不阻塞，同名只能有一份活动运行。
2. 另终端 stop、重复停止、已经停止、启动中停止、Ctrl+C/TERM 使用同一资源台账。运行中改配置不改变当前关闭对象。
3. 停机期间保持 handler/provider 可用。窗口关闭与整个 run 退出分开，应用退出意图转给 run 控制面，不能提前杀死窗口 provider。
4. 原始错误和清理错误分别保留；保存失败或超时报告非零状态，保留可诊断和可重试控制，不默认 force-stop，不把超时当成任务已停止。
5. 陈旧 PID、旧端点、未授权请求和端口冲突不能误操作其他运行；核实资源状态后才记录停止成功。端口不可连接不单独证明全部进程退出。

**先写验证：**逐阶段启动中断、另终端 stop、重复控制、配置修改、陈旧 PID、端口冲突、权限拒绝、保存失败、handler 超时和同名重启。真实进程确认 Rust 退出与资源释放。

**出口：**M1 达成；真实片段对称启停，关 A 不影响 B，关闭结果包含业务、Rust 进程、本地清理与宿主资源。

## 9. P4：独立前后端与 Projection 链路

**修改范围：**desktop host/renderer/preload、虚拟模块、Agent discovery、遥测、Electron 窗口 Adapter 和业务客户端绑定；共用前端包仍零业务语义。

**任务：**

1. 前端读取本 run 的公开发现信息，由宿主注入 Snapshot/Client 服务，不从业务 State 取端口或凭证，不读取用户级唯一 discovery。
2. daemon Projection 接入现有应用投影链路，断连后重连获取一致快照；不能从旧 N-API 图转发或伪造业务事实。
3. 固定命令校验实际装配的 rendererRoots，Agent/场景控制与前端权限分开，取消只影响本 run 对应 submission。
4. Electron userData、session、单实例身份、前端端口、遥测和 Agent 服务分别注入 run 参数。无前端片段不启动无关服务。
5. 退出请求进入 P3；图内窗口动作继续经执行/观察节点，不由控制工具绕过业务协议。

**先写验证：**两个有前端 run 展示各自投影、发送各自命令；投影重连、revision、权限拒绝、第二实例及视窗关闭；后端故障不误报成功或连接别的 run。

**出口：**两个前端、后端和 daemon 同时运行，数据、命令、投影、缓存和发现文件不串用。

## 10. P5：同一 run 上的场景测试

**修改范围：**tooling/run 的场景执行、报告、时钟接入；各 run 的 scenarios 与实际装配事实校验。局部单 Node Vitest 工具保留。

**任务：**

1. 配置声明场景输入、Projection/Info/Effect 断言、时钟和结束条件；场景只使用当前 run 的真实控制面，不另建 Runtime 或复制业务逻辑。
2. 无场景时正常交互，有场景时业务就绪后执行，结束后走 P3 stop。UI 场景使用本 run 前端，不借用正式程序窗口。
3. 完成依据明确回执和结算屏障，不把单 submission 完成或瞬间空队列当成全业务完成；周期来源需要显式暂停。
4. 成功、失败和超时均保留断言及清理报告，原始失败退出码不被清理成功覆盖。

**先写验证：**同一装配交互和自动场景；断言失败、超时、Effect/保存失败、失败后重试和迟到结果；检查真实 Rust 调度及当前片段的事实。

**出口：**M2 达成；两个 Agent 能用各自配置开发、运行和测试，无第二套测试启动路径。

## 11. P6：整个 Studio 切换与旧入口移除

**修改范围：**Studio desktop/main.mjs、services/application-lifecycle.mjs、项目/生成服务、窗口执行/观察、backend 工厂及前端绑定；desktop package.json、host/main.mjs 和 application 参数；正式完整程序的命名 run。

**任务：**

1. 完整 run 配置显式列出全图、前后端、Adapter、项目参数和初始化/启停输入，使用 P1–P5 已验证机制。
2. 从 Electron main 移除内核创建和隐式插件装配。后端执行真实 Studio Node 与服务，Electron 保留前端宿主及必需窗口 provider。
3. 生命周期协调器的同步 NativeRuleSpace 操作、pump 和订阅迁为明确 daemon 接入；保留业务 Info、requestId、阶段和迟到回执防护。通用工具不导入 Studio。
4. 验证项目打开、编辑、生成、观察、保存和投影；完整退出保存成功后才关闭窗口、推出节点、关闭内核及宿主。
5. 验证标题不变的 prompt/content/history 及保留记录完整事务保存，磁盘失败回滚。拆进程不增加重复 State、跨 generation 重放或自动恢复。
6. 完整 run 验收通过后，在明确切换提交中移除旧 npm start/prestart 和直接 Electron 自启动装配，更新用户启动说明及实际产物 smoke。底层安装、构建和单测可保留，但不自启动整程序。

**先写验证：**实际 Studio 项目全量落盘、生成停止/在途结算、保存/窗口失败、启动中退出、重复退出和迟到回执。优先受控适配场景，不用黑盒开发服务器肉眼观察代替验证。

**出口：**整个程序只用新 Bash run 正常运行，可另终端 stop；没有 Electron 内嵌第二份生产图或保留旧启动权威；完整程序与 Agent run 并行。

## 12. P7：三 run 演练和文档收敛

同时运行正式整程序、开发新插件的任意命名 run、跨插件片段/测试的另一个 run。分别操作、停止、重启并集成公开契约或源码变更，核对每个 run 的资源、投影、日志和清理。

同步 mental-model、SDK 心智模型、目录边界、测试指南、desktop README、应用生命周期及 AGENTS。参考文档只写已交付事实，协作指南补实际执行步骤，未完成项保持标记。

运行配置、源码和场景可提交，凭证、数据库、缓存和运行记录不可提交。正式程序不能隐式依赖某 Agent 的工作目录。演练结束核实全部进程、监听、租约和锁释放，数据按配置保留，工作树无无关变动。

**出口：**M3 达成，团队仅凭配置及协作指南即可独立开发、启动、测试、停止和交付一个 run。

## 13. 工作包所有权和提交

| 分工 | 文件所有权 | 可并行前提 |
| --- | --- | --- |
| 协调和 run 工具 | run.sh、tooling/run、配置契约、集成文档 | P0 确定；负责共享工作树提交 |
| SDK/daemon 桥接 | JS Node/Effect/Agent、Rust daemon、共同契约和镜像 | 使用同一已确定契约 |
| 前端/构建接入 | desktop build/renderer、发现与隔离资源 | P1 输出和 P3 控制契约确定 |
| Studio 切换与场景 | Studio 生命周期、服务和完整 run | P2 兼容性及 P4 传输通过 |

此表用于后续任务分配，不要求本轮启动多个 Agent。共享文件不得多任务同时修改；Agent 用各自命名 run 验证，协调者按依赖集成。目录隔离不隔离同一 Git 索引，共享工作树集成串行进行。

每工作包先写最小失败用例，再实现并小步提交，提交前检查 status/diff。代码变化完成 desktop 与 JS SDK 类型检查，相关 Vitest 使用 --silent；Rust/协议变化执行对应 Cargo、黄金帧及镜像验收。只扩大有理由的验证，不无意义跑全量测试。

## 14. 最终验收清单

- [ ] 任意命名 run 自有配置，start/stop/status 显式指定配置。
- [ ] 范围独立于插件，未选实例不构造，切口明确可断言。
- [ ] 初始化与启动分开，业务初始事实与物理参数分开。
- [ ] 内核、拓扑、Info 操作独立，Bash 对称编排。
- [ ] 整程序和两个 Agent run 的前端、后端、权威图及资源并行隔离。
- [ ] 另终端 stop、Ctrl+C、启动中停止、重复控制及重启通过。
- [ ] 保存失败和超时不冒充成功，原始错误与清理错误均保留。
- [ ] handler、Effect、租约和本地 dispose 有明确结算确认。
- [ ] 场景与正常运行共用真实装配、Rust 调度及完整关闭。
- [ ] Studio 完整运行与全量保存通过，旧整程序启动路径已替换。
- [ ] 修改配置、陈旧 PID/端点和端口冲突不误操作其他运行。
- [ ] 参考文档、实际入口、产物和协作指南一致，凭证与生成物未提交。

本轮仅修订实施计划，工作包均待执行，不提前创建占位启动脚本或宣称命令可用。
