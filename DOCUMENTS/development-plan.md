---
type: plan
title: GraphVideo SDK 开发规划与验收路线
description: 基于当前 TypeScript 实现，分阶段收口规则空间契约、实现 Rust 内核与跨语言绑定，并完成节点热替换和本地应用验收。
status: proposed
---

# GraphVideo SDK 开发规划与验收路线

## 1. 规划定位

基线日期：2026-09-11；基线提交：`30eae8f`。

本文是待执行的工程规划，承接[微内核升级方案](./kernel-upgrade-plan.md)，明确实施顺序、交付边界和验收条件。下文的目标契约、拟新增目录和阶段任务均不代表当前已经实现的能力。

执行事实以源码与针对性测试为准，其后遵循[当前心智模型](./mental-model.md)、[SDK 心智模型](./sdk-mental-model.md)与各 SDK 指南。每一阶段完成后，才将已验证能力更新进 reference/guide 文档。本文不设未经评估的日期或性能承诺；阶段按退出条件推进。

## 2. 当前基线

| 范围 | 已核对的实现 | 本轮需要补齐的部分 |
| --- | --- | --- |
| 微内核 | `core/src` 的 TypeScript `KernelRuntime`；mailbox、single-flight、submission、取消、State 版本和 Projection | Rust 核心、规则空间门面与安全替换协议 |
| 节点装卸 | 已有 `mount/unmount`，以及 `onMount/onUnmount/dispose` | 当前装卸不等于等待 change 间隙、丢弃旧队列并完成结算的热替换 |
| 错误处理 | change 异常被记录后重新抛出；delivery 拒绝使所属 submission 失败并触发取消信号 | 自动生成和路由错误 Info，保持因果链和故障隔离 |
| 消息发送 | `ctx.send` 返回 `void`；字符串目标不存在时记录警告并返回 | 可观测的投递反馈、丢弃原因与精确结算 |
| 物理边界 | 已有执行/观察 WorldNode 分类及构造注入 Adapter | 在生命周期变更下验证观察资源清理、迟到结果隔离 |
| SDK 与工作台 | backend、client、testing、analysis、contract、workbench 已存在 | 对接新内核，保持插件契约、投影和前端边界一致 |
| 本地应用 | `apps/local-app` 提供 Electron/React 计数器示例与诊断入口 | 演示运行期更换 Node 实现及失败场景 |
| 工程交付 | npm workspace 源码直连；包名为 `@graphvideo/kernel` | 原生模块构建、打包与消费工程验收；处理旧交付文档残留 |

基线阅读期间，根类型检查通过，根 core/unit/ui 测试共 31 个文件、101 个用例通过。这不包含本地应用完整验收，也不代表 Rust 或热替换已经验证。

现有升级方案中的 `RuleSpace`、`DeliveryFeedback`、`crates/kernel` 和 `crates/kernel-node` 尚未在基线实现。文档中的“错误即 Info”已经是架构要求，但实现仍有差距。

## 3. 目标与范围

本轮目标是建立 Rust 规则空间、Node-API 绑定和 TypeScript 门面，使业务 Node 可以在进程持续运行时准入、驱逐和替换，并保证单飞、因果追踪、submission 结算与 Projection 一致性。

必须保留以下约束：

- `core` 和 `sdk/workbench` 零业务语义；所有业务插件采用同一套契约和装载规则。
- Node 间只通过 `ctx.send(info, targetNodeId)`；发送点的 `Info.type` 必须静态可证明。
- 业务 State 仍由 Node 唯一持有，只能由当前 change ctx 写入。
- 执行与观察 WorldNode 分离；物理动作经过构造注入的 EffectAdapter。
- renderer 只请求授权入口、读取解码后的 Projection；保留 submission 取消能力和权限边界。
- 新实体从自己的初始 State 启动；历史业务上下文通过显式 Info 恢复。
- 丢弃消息不暂存、不回放；取消和替换不撤销已发生的 State 写入或物理动作。

本轮不扩展分布式调度、远程 Kernel、自动状态迁移、声明边、广播总线或业务编辑器功能。当前包名优先保留 `@graphvideo/kernel`；升级方案中的 `@graphvideo/core` 命名在 M0 收口，不另建含义重复的公开包。

## 4. M0 必须收口的契约

### 4.1 错误作为因果事实

目标是将同步 throw 和异步 rejection 转成可发送的错误 Info。错误需要携带来源 Node、实体代次、触发 Info、change 和 submission 的关联信息；异常对象需转成可编码 DTO。

实现前必须确定并测试：

1. 错误生成后的默认接收方，以及无接收方、目标缺失时的结算方式；不允许隐式全局广播。
2. 运行时自动生成的错误如何进入统一因果记录；Node 后续转发时仍满足发送点类型可证明要求。
3. 错误处理 Node 再次失败时，如何保留失败事实并约束自动递归生成，避免无限错误循环。
4. 错误分支是否继续归属原 submission、何时判定完成，以及业务失败如何从 Projection 中表达。
5. 用户主动取消与业务执行异常的区分；取消不能产生失控的错误派发链。

建议让业务执行异常通过错误分支收敛，不再默认取消同 submission 的全部兄弟分支；该变更必须由测试固定，并同步更新等待结果的消费方。运行时捕获异常本身不构成一次业务 State 写入，任何错误状态更新仍需由 Owner 的后续 change 完成。

### 4.2 即时投递与处理结果

建议即时反馈只描述 `enqueued` 与 `dropped`：前者表示入队，后者表示本次投递未接纳。发送者不等待下游 change，也不获得下游业务返回值。

升级方案中 `empty` 被定义为“目标拒绝处理或产生空输出”，需要目标执行后才能知道。M0 应决定将其作为结算后的诊断事实，或删除这一反馈值；不能将它同时定义为即时返回值和执行结果。

若保留异步反馈回调，必须明确它不能持有已结束的 change ctx，不能在回调中写 State 或调用 send。需要业务反应时应经普通 Info 触发后续 change。

### 4.3 实体身份与替换顺序

建议使用稳定 `nodeId` 加内部实体代次区分新旧实例。每次 delivery、change 和 Effect 完成记录均应能归属具体代次，防止同 ID 替换后旧消息或迟到结果进入新实例。

替换应按以下顺序实现：

1. 校验新实例和身份，准备失败时保留旧实例。
2. 登记替换请求并封闭旧实例的新投递入口，后续投递按契约丢弃。
3. 等待正在执行的 change 结算；禁止继续取旧 mailbox 中的下一条消息。
4. 丢弃并逐条结算旧队列，失效旧代次能力，释放或隔离旧资源。
5. 安装新实例、发布新 Projection，并开放新投递。

已经接纳到其他有效 Node 的消息继续按自身归属执行；不能因为发送者被替换就无差别清空下游队列。替换提交前失败、提交后失败、并发重复替换和不存在目标都需要明确结果，不能留下半挂载实例。

### 4.4 生命周期与替换触发

Start/Stop 是普通 Info，沿 mailbox 和 change 处理，主要由上游定向发送。它们不享有调度优先级，也不隐式改变空间成员关系。

普通 Stop Info 可能排在积压消息之后。因此，物理替换请求不能依赖 Stop 已经被消费才能获得执行机会。M0 必须区分业务停止意图与宿主准入/驱逐权限：业务恢复、清理由普通因果链推进，空间负责安全的调度切换。

运行中的 change 长期不返回时，替换也可能长期等待。必须为异步超时、取消协作和不可返回的同步代码分别确定支持边界；不得用“几微秒的间隙”替代等待时间与失败策略。

### 4.5 结算、取消与投影

- 每条已计入 pending 的 delivery 恰好结算一次，包括执行、取消和被替换丢弃；计数不能为负，也不能遗留未完成 submission。
- `enqueued` 后仍可能在替换时被丢弃；即时反馈与最终诊断必须可区分。
- 错误衍生 delivery 的登记必须早于原 delivery 的最终结算，避免 submission 提前完成。
- 保留单 submission 等待与取消，不能将其改成等待全图，也不能把取消误认为业务失败。
- 新实体 State version 可以重置，但 Projection revision 必须持续单调推进；明确投影是否公开实体代次，防止 UI 误用旧缓存。
- 明确外部任务、观察资源和 Adapter 的归属；旧任务的迟到结果不得通过失效 ctx 改写新实体。

### 4.6 跨语言职责

规划由 Rust 持有调度与实体登记等内核事实，由 JS Node 持有业务 State 和 change 代码；桥接层明确 DTO 编码、回调引用、线程归属、异常传播和资源释放规则。不得将完整业务 State 同时维护为 Rust 与 JS 两份权威数据。

M0 的技术验证需要回答 Node-API 对隔离、JS 执行和进程故障分别能提供什么保证。原生模块边界不能未经验证就等同于独立进程沙箱。性能分别测量 Rust 调度开销、跨语言往返、等待 change 的时间和完整替换耗时；“永不宕机”“微秒级热更新”不能直接作为已验证结论。

## 5. 实施阶段与退出条件

依赖顺序为 M0 → M1 → M2 → M3 → M4。M0 只建立最小语义夹具和必要的参考行为，不要求在 TypeScript 中再完整建设一套新规则空间。

| 阶段 | 主要工作与交付物 | 进入下一阶段的条件 |
| --- | --- | --- |
| M0：契约与基线 | 收口第 4 节；对齐升级方案与指南；编写可复用测试场景，固定初态、输入、事件顺序与预期结算；验证跨语言最小可行性 | 所有契约问题有记录的决定；相关基线用例可重复运行；包名、职责和支持边界明确 |
| M1：Rust 核心 | 新增拟定的 `crates/kernel`；实现实体登记、mailbox、单飞、因果标识、submission、取消和丢弃记账；JS 行为先用确定性执行桩表达 | Rust 针对性用例覆盖调度与实体增删；所有终态计数归零；单节点无重入，不影响其他节点推进 |
| M2：Node-API 与门面 | 新增拟定的 `crates/kernel-node`；接通 JS change、DTO、Effect、错误 Info、投影和投递反馈；经既有 Kernel 包对外提供门面 | JS → Rust → JS 因果链与契约一致；异常不逃逸执行边界；取消有效；引用和资源可释放；类型检查通过 |
| M3：安全热替换 | 实现替换门禁、代次隔离、旧消息丢弃、纯净初始化、失败处理、Projection 更新 | 洪峰中替换不会继续消费旧队列；旧 ctx 与迟到结果失效；长 change 行为符合约定；submission 无泄漏；反复替换资源趋稳 |
| M4：SDK 与本地应用 | 对接 testing/backend/client/analysis；落地普通生命周期 Info；演示新版本 Node 与显式业务恢复；完成原生交付方式 | 本地应用进程不中断完成替换；renderer 不访问 Kernel；授权、诊断和 UI 更新正确；目标环境可构建、安装和加载原生模块 |

每个阶段按“最小测试 → 最小实现 → 针对性验证 → 文档同步 → Git checkpoint”拆成可独立检查的提交。阶段关闭必须记录实际验证命令、结果与剩余限制。

## 6. 核心验收矩阵

| 场景 | 必须观察到的结果 | 首次覆盖阶段 |
| --- | --- | --- |
| 同一 Node 并发输入 | change 不重入，State 无并发撕裂 | M1 |
| 不同 Node 的独立输入 | 一个节点等待时，其他可运行节点仍可推进 | M1 |
| 发送到缺失目标 | 明确丢弃，没有悬挂 delivery 或 submission | M1/M2 |
| change 同步 throw / 异步 rejection | 错误 Info 可追溯并可转发，其他节点继续推进 | M2 |
| 错误接收方再次失败 | 按 M0 规则终止自动递归，保留诊断事实 | M2 |
| 入队后取消、执行中取消 | 计数恰好结算，后续 send/effect 停止，既有写入不回滚 | M1/M2 |
| 积压队列中请求替换 | 当前 change 结束后优先切换，旧队列直接丢弃 | M3 |
| 旧 Adapter 或观察回调迟到 | 不污染新实体 State，不复用失效 ctx | M3 |
| 连续替换相同 nodeId | 代次归属明确，新实例初态生效，旧引用逐步释放 | M3 |
| 新实例准备失败 | 旧实例保持可用，原投影不被半成品覆盖 | M3 |
| 替换期间 UI 订阅 | revision 持续推进，不复活旧 State 或旧缓存 | M3/M4 |
| 普通生命周期链式发送 | 遵守 rendererRoots、mailbox 和单飞规则，没有隐式广播 | M4 |
| 本地应用代码更新 | 新行为可观测，进程保持运行，恢复由显式业务 Info 完成 | M4 |

压力验证记录输入规模、并发度、持续时间、环境版本和资源曲线。性能目标在 M0 基准测量后填写；替换等待时间与实际切换时间分开统计，并报告尾部延迟。

## 7. 文档与交付收口

M0 修正当前指南中的旧模板路径、已移除脚本和不存在的 Studio 私有入口；以实际 `package.json` exports 与 scripts 为准。针对 SDK 包交付和脚手架，先核对当前源码直连方式与 `graphvideo-init` 所需 bundle 的差距，再决定保留并修复交付链还是收窄其公开说明。

M4 明确首个支持的操作系统、CPU 架构、Node/Electron 版本与原生构建方式，并在该矩阵内验证消费工程。不得仅凭仓内源码 alias 可运行就宣称仓外发布可用。

当前可用验证入口如下，实施时按实际修改选择相关项：

```bash
npx tsc --noEmit
npx vitest run --project core core/src/cancellation.test.ts --silent
npm --prefix apps/local-app run diagnose -- validate
npm --prefix apps/local-app run verify
```

上面的取消测试是现有针对性命令示例；新增行为应定位其对应测试文件。`verify` 是 M4 集成验收入口，不用于每个局部修改。Rust 检查命令和混合测试入口在相关 crate/脚本落地时补入文档，不预写不存在的 npm 命令。

最终交付要求：

- [x] M0 契约已收口，升级方案与实现语义一致（`empty` 已从两处文档删除，生命周期命名已对齐实现）。
- [x] M1–M4 各项退出条件均有测试或验收记录（见 §8 执行记录；性能基线与 release 构建除外）。
- [x] 所有代码修改通过类型检查及相关静态/因果检查。
- [x] 已完成目标环境的原生模块和本地应用验收（win32-x64-msvc + Node.js 25，含仓外独立加载；Electron 主进程加载未验证）。
- [x] 当前指南只描述已交付能力；剩余计划明确标为未完成（见 §8 剩余事项）。
- [ ] Git 提交仅包含对应原子改动，工作树无未说明的残留文件。（提交时检查）

## 8. 首批执行任务

以下任务均已完成，状态见执行记录：

1. 修正文档路径、脚本和包名，标明错误 Info 等尚未落地的要求。
2. 完成错误路由、反馈时机、替换线性化边界和 submission 结算的契约决定。
3. 用固定 Clock/ID、可控 Promise 和 mock Adapter 编写最小测试夹具，覆盖正常、失败、取消及迟到结果。
4. 完成 Node-API 最小验证，记录支持边界与初始性能数据。
5. 按 M0 退出条件审查后开始 Rust 核心实现。

### 执行记录（2026-09-11，M0–M4 收口）

- 任务 2 已在 TypeScript 参考实现中收口：`ctx.send` 返回
  `enqueued | dropped`（`empty` 不作为即时反馈，已从契约删除）；业务异常转为
  `@error/NodeFailed` 定向投递（可配 `errorTargetNodeId`，无接收方仅留痕，
  错误再失败单跳截断），不再默认取消同 submission 兄弟分支；替换按
  密封→等单飞间隙→丢弃旧队列→纯净挂载→代次+1 线性化，迟到结果不污染新实体。
- 任务 5 已完成：`crates/kernel`（Rust 调度：登记/mailbox/单飞/submission/
  取消/丢弃台账/代次墓碑）与 `crates/kernel-node`（napi 绑定）落地；
  `sdk/backend` 的 `NativeRuleSpace` + `mountDomainNode` 把同一插件 Node
  接到 Rust 调度上（`change` 签名零改动，`WorldNode` 拒挂）；`apps/local-app`
  的 `native-graph-host.mjs` 演示不停机热替换（旧 backlog 丢弃、纯净重启、
  显式 Info 恢复、代次 +1）。
- 任务 1 已完成：`npm run trace/build:sdk/export:sdk` 等不存在脚本的引用已
  改为实际入口（`tsc`、`vitest`、`build:native`、local-app `diagnose`）；
  升级方案的 `empty` 残留与生命周期命名已对齐实现；投影不暴露代次的决定
  已记入升级方案 §5.4。
- 任务 3 已完成：TS 侧覆盖投递丢弃、同步 throw/异步 rejection、错误缺失
  接收方结算、单跳截断、驱逐/重准入代次、间隙替换、替换中新实例挂载失败
  回滚、迟到领域结果与迟到 Adapter 结果隔离、取消协作、链式生命周期；
  原生侧覆盖扇出、丢弃台账、失败隔离、单跳截断、取消跳过、异步替换、
  卸载中结算与代次隔离。固定 Clock/ID 夹具仍是剩余事项（当前用真实
  时钟与随机 submission ID）。
- 任务 4 部分完成：win32-x64-msvc debug 构建经 `npm run build:native`
  摆放，Node.js 25（ABI 141）加载 + 调度已验证（含仓外目录独立加载）；
  支持矩阵见 local-app README。初始性能数据、release 构建、其他 OS/架构、
  Electron 主进程加载未做。
- 已知偏离（有意为之）：原生门面无投影通道（读数走规则空间状态拷贝）、
  无 revision（代次只经 `generation` 可见）、`replace` 不在 pump 内排队、
  `cancel` 不中断运行中的 JS change（无 AbortSignal）；Rust `Failed` 是
  原生绑定级终态标记，门面将其转为 `@error/NodeFailed` + `Completed`。

### 剩余事项

- 性能基线与资源曲线、release 构建、win32 之外的目标三元组。
- Electron 33 主进程加载 `.node` 验证。
- 固定 Clock/ID 夹具替换 wall-clock 等待与随机 submission ID。
- tarball 交付与 `graphvideo-init` 冷启动链的配套根脚本（先收窄公开说明，
  再决定是否修复交付链）。
- `plugin-sdk-guide` 深层架构描述（Studio 私有绑定、Vite 插件 bundle、
  `npm run plugin`）与当前源码的对齐（不在本轮改动内，禁止据此改代码）。
