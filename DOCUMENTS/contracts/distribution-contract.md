---
type: Contract
title: SDK、插件与协作分发契约
description: 镜像 SDK、协作知识与能力包分享、独立制品、版本兼容、任意目录接入与性能验收的协作要求。
status: stable
tags: [distribution, packaging, collaboration, acceptance, compatibility]
---

# SDK、插件与协作分发契约

本文件规定正式交付必须满足的要求。目录职责以 [SDK 心智模型](../architecture/sdk-mental-model.md) §1 为准（包边界、应用装配、源码构建组织）；目录归位不等于制品已经通过独立发布验收。这里的制品清单不表示仓库存在自动打包、安装或发布流水线。

## 1. 共同契约与镜像边界

JavaScript 与 Python 是同一 SDK 能力面的两种语言适配。镜像的是协议与行为，不要求复制类结构、Promise、asyncio 或浏览器实现。

| 能力面 | 共同验收内容 | 当前适配入口 |
| --- | --- | --- |
| protocol | JSON 字段、协议版本与错误码 | JS protocol；Python protocol |
| node | Owner State、single-flight、定向 Info、generation、批量 commit | JS node；Python node |
| effect | Request/Observation、能力绑定、失败与取消 | JS effect；Python effect |
| plugin | 同一 Manifest、插件身份与发布所有权 | JS plugin；Python plugin |
| analysis | 便携事实、operation、foldDepth/folds、结果 DTO | JS analysis + node/agent 的 Rust 查询；Python analysis |
| agent | inspect/analyze/inject/patch、预期版本与审计字段 | JS agent；Python agent |
| testing | 同一输入、状态版本、收敛条件、错误及 generation 断代断言 | JS testing；Python testing |

JavaScript 可用 N-API 或 daemon，Python SDK 当前使用 daemon；Python ctypes 直接驱动 C ABI 的样例属于 Rust 包。七个目录存在并不能证明全部 API 和异常分支已经等价。JS 的 Node 类、测试 Oracle、实例扫描与显式离线算法不要求 Python 实现副本；两种语言的生产执行与分析都以同一 Rust 契约为准。

`packages/contract/` 当前保存 `version.json`、`operations.json`、`errors.json` 和两份 `golden-frames/`。它是跨语言协议清单与验收数据的共同来源；当前没有完整 JSON Schema、兼容矩阵或镜像能力矩阵，不应在接入指南中宣称这些已经提供。

跨语言公开能力变更应同步更新共同契约、Rust 权威实现及两套 SDK，并用同一黄金用例检查 DTO、错误、取消、State version、submission、generation 与 Agent 语义。任一侧缺项不能宣称镜像验收完成，也不能形成长期私有协议。

## 2. 应用与独立插件

应用以 `application.json` 或 run `assembly.mjs` 显式选择插件及路径。本仓库核心插件在 `app/plugins/`，非核心插件在各自 run 下的 `plugins/`（如 `runs/<name>/plugins/` 或 `runs/main/plugins/`）。**非核心插件绝对不进入 `app/`**。平台生产源码不得导入业务插件实现；插件不得相对导入另一个插件的内部源码。

正式插件仍是普通插件，只由指定发布者整体更新。接收方为工作流补充的自动化能力与团队定制 Node 放在自己的普通插件中，通过公开目标 Node 与定向 Info 协作；工作流说明文档不是插件。完整规则见[插件发布与协作契约](plugin-collaboration-contract.md)。

发布插件的交付形状为：

```text
<plugin-id>/
  graphframework.plugin.json
  PACKAGE.md
  backend.<语言扩展名>
  analysis/folds.recommended.json
  docs/INTEGRATION.md
  elements/                         需要用户操作时提供
  workspaces/                       需要工作区时提供
  frontend/ desktop/ resources/     按实际业务接入需要提供
```

这是正式交付要求，不是当前示例插件全部具备这些文件的声明。PACKAGE.md 使用 OKF，记录职责、发布者、公开 Info/Projection、兼容版本、整体更新限制、升级影响和摘要。推荐折叠文件覆盖该插件的全部基础 Node；完整应用的 folds 由消费方显式组合，不由 Rust 自动合并。

需要通过团队协作通道分享一组后端 Node、前端和它们的组合关系时，外层压缩包还必须携带一个 run assembly contribution。该模块通过 `backendPlugin/frontendPlugin/node/graph/frontend/requireNode` 重新建立实例、绑定、UI 与既有核心 Node 依赖；工作流和知识说明文档通过自建服务端分发。只压缩插件目录而不携带 assembly，会丢失跨插件装配逻辑，不能视为可运行的完整分享物。

前端保持达芬奇色彩与排版语言、现有工作台切分/停靠/尺寸调整/浮动页面、刷新与页面联动。面板内部按钮、表单和业务命令由插件自行实现，不要求统一控件 DSL；无用户操作需求的后台插件无需前端。

## 3. 协作分享策略

团队协作内容按职责分离；基础软件另走批量更新：

| 分享对象 | 分发载体 | 权威内容 | 不携带内容 |
| --- | --- | --- | --- |
| **通用知识与工作流** | 自建服务端 | 可共同维护的知识正文、工作流步骤、适用条件及所需能力版本 | Node/前端源码、二进制、凭证 |
| **工作流场景分享** | 单个独立 Run (`runs/<name>/`) 或协作通道能力包 ZIP | `run.config.json`、`assembly.mjs`、该工作流专用的非核心插件集合（保持在 run 下）、针对性测试用例 | 核心 Node、SDK、内核、桌面宿主、`AGENTS.md`、Skills、个人凭证 |
| **基础软件更新** | 团队批量更新通道 | `packages/` + `DOCUMENTS/` + `app/` 的全面更新（其中 `app/plugins/` **仅包含核心插件**） | 个人上下文、工作流选择、非核心插件 |

> [!IMPORTANT]
> **非核心插件不进入 `app/` 铁律**：
> - `app/` 仅承载核心配置与正式交付的**核心插件（Core Plugins）**；
> - **所有非核心插件（业务流程、自动化策略、工作流专用节点）绝对不进入 `app/`**，只保存在对应 run 目录下的 `runs/<name>/plugins/` 中；
> - **先跑通测试再并入 main**：工作流分享以单个完整 run 为沙箱，接收方必须在独立 run 中先跑通针对性测试与场景验证；验证通过后，工作流可通过 `runs/main/assembly.mjs` 以及 `runs/main/plugins/` 并入主 run，但**非核心插件依然绝不进入核心 `app/`**。

基础软件批量更新必须由仓库中的统一打包脚本生成，不能由发布者临时手选文件。脚本负责生成带版本号的基础软件压缩包（包含 `packages/`、`DOCUMENTS/` 与 `app/` 核心部分）、文件清单和 SHA-256，并排除 `AGENTS.md`、`.agents/skills`、协作知识与工作流说明正文、账号凭证、用户数据、缓存及 `.generated`。基础软件包只负责整体软件更新，不改变成员选择了哪些工作流。

自建服务端是通用知识和工作流说明的唯一协作来源。`AGENTS.md` 只保存开发守则与新成员环境初始化要求，不复制工作流正文，不携带账号凭证，也不随能力 ZIP 分发。

一份工作流说明至少说明：稳定名称与维护者、适用任务、前置知识条目、所需能力版本、向哪些专用 WorldNode 发送什么 Info、等待或监听哪些 Observation/完成事实，以及失败与人工确认边界。工作流不定义新的注入协议、消息总线或运行时；Agent 读取说明后，仍只使用已装配的专用 WorldNode 和现有 Info 契约完成发送与等待。


### 3.1 协作通道能力包

能力包使用 `<capability-id>-<version>.zip` 命名，保持简单目录形状：

```text
<capability-id>/
  assembly.mjs
  plugins/backend/<plugin-id>/...
  plugins/frontend/<plugin-id>/...    # 仅在需要 UI 时存在
```

其中每个插件继续携带自己的 Manifest、`PACKAGE.md` 和接入说明；`assembly.mjs` 使用相对路径贡献插件、Node/Graph 实例、bindings、前端实例和 `requireNode` 依赖。`requireNode` 指向的核心组件由基础软件批量更新提供，不复制进能力包。ZIP 不得包含 `node_modules`、`.generated`、缓存、日志、State 数据、账号令牌或其它本地凭证。

发布者在协作通道消息中同时写明能力包 ID、版本、用途摘要、最低 GraphFramework 版本、对应工作流说明链接和 ZIP 的 SHA-256。每个附件都是不可变发布快照；更新时发送新版本文件和新摘要，不覆盖旧附件，也不把通道消息当作工作流正文。

接收方只接收可信团队成员发布的包，先核对文件名、版本和 SHA-256，再解压到受管理的能力目录。首次安装时把其中的 assembly 模块加入主 run 的 `assembly.modules`；同一能力的后续版本按 §3.2 原位更新，不能继续追加另一份 assembly。assembly 是会在取得 run 锁前执行的可信代码，不能直接装载来源不明的通道附件。装配后先执行 run 配置校验，再通过唯一入口 `run.sh` 启动。

多个能力包重复贡献完全相同的插件、Node/Graph 实例或前端实例时，由 run 装配按 ID 自动去重，不需要人为复制或改名。相同 ID 的工厂、参数、bindings 或来源不同则是真实冲突；Agent 必须比较双方定义，明确选择保留版本或在扩展插件中做兼容，禁止静默覆盖核心 Owner。

### 3.2 同一工作流的更新

工作流使用稳定的工作流 ID、说明条目和能力包 ID。原工作流得到改进时，直接更新原说明条目中的版本、变更摘要和所需能力版本；不得新建同名条目或把改进版伪装成新的工作流。

如果改进涉及代码，发布同一能力包 ID 的更高版本 ZIP，并在通道消息中明确“替代哪个旧版本”。旧附件保留在通道历史中只用于审计和人工回退取证，不代表允许并行安装。assembly contribution ID、插件 ID 和对外 Node ID 在兼容更新中保持稳定。

接收方先停止主 run，将新 ZIP 解压到临时目录并校验摘要与包内身份，然后整体替换本地旧能力目录；`assembly.modules` 中继续只有该工作流的一条选择，不追加新旧两个路径。替换后先验证完整配置和冲突，再通过 `run.sh` 重启。更新造成的 generation 断代、State 重置和 backlog 丢弃仍遵守现有内核语义；需要保留业务数据时，必须由工作流或插件通过显式 Info 设计迁移，不能依靠文件覆盖自动继承。

只有当两个版本的任务目标或公开契约已经分叉、并且确实需要同时存在时，才创建新的工作流 ID、说明条目和能力包 ID；这属于 fork，不属于原工作流更新。

### 3.3 发布与接收顺序

发布顺序固定为：先更新协作服务端中的知识或工作流说明并标注所需能力版本；再验证 assembly 能在完整主 run 中装配；随后用 `bash ./run.sh pack <capability-dir> [out.zip]` 压缩能力目录并计算 SHA-256（输出 `<capability-id>-<version>.zip` 与同名 `.sha256`），在协作通道发送附件及上述元数据。命令实现见 `packages/tooling/run/src/package.mjs`（`packCapability`）与 `packages/tooling/run/src/cli.mjs`（`pack`），覆盖用例见 `packages/desktop/host/p10-capability-share.test.mjs`。

接收顺序固定为：从协作服务端确认所需能力版本；从协作通道取得对应 ZIP；用 `bash ./run.sh verify <capability.zip> [--expect-sha256 <hex>]` 校验发布者、文件名、版本与摘要；判断是首次安装还是同一工作流更新；用 `bash ./run.sh install <capability.zip> [--run <run.config.json>] [--update]` 安装——首次安装才新增一条 assembly 选择，更新则整体替换原能力目录；`install --run` 在写入前用 ZIP 内容做冲突预演，冲突时报告双方定义且不修改 run 配置与已装目录，本地已装能力被改过时先报本地编辑；安装后运行配置校验；若没有冲突则进入统一主 run。工作流说明的更新不自动修改代码。命令实现与覆盖用例同上（`verifyCapability`/`installCapability`）。

基础软件打包（SDK tgz/wheel、Rust daemon/C ABI/N-API、桌面 Electron 分发制品）仍走团队批量更新通道，当前仓库尚未交付统一基础软件打包脚本；能力包的通道上传/下载仍由成员显式完成，不宣称自动发布。

## 4. 独立制品与兼容信息

按实际发布范围交付制品，并为每个制品提供独立版本、内容清单、SHA-256 和接入指南：

| 制品 | 格式与边界 |
| --- | --- |
| JavaScript SDK | `@graphframework/sdk` npm tgz，七个子路径；发布消费需包含 dist 与适用的原生绑定 |
| Python SDK | `graphframework-sdk` wheel/sdist，七个模块 |
| frontend / desktop | 按宿主生态交付源码包或构建制品，不属于 Python 镜像 |
| contract | 协议清单、黄金帧与发布兼容信息 |
| Rust daemon | 对应平台的可执行文件及启动/连接说明 |
| Rust C ABI | 动态库、头文件、协议版本与宿主 State 所有权说明 |
| Rust N-API | 按平台命名的 `.node` 及包内定位说明 |
| 普通业务插件 | 含 OKF、接入指南、推荐折叠配置的版本化 ZIP |
| 组合能力分享包 | 工作流说明链接、run assembly contribution，以及该贡献实际提供的后端/前端插件 ZIP；不复制 `requireNode` 指向的核心组件 |
| 桌面应用 | 对应平台的 Electron 分发制品及 application 配置 |

发布清单记录 SDK、daemon、C ABI、N-API 与桌面宿主兼容版本，插件声明实际需要的最低版本。当前 desktop/frontend 使用源码和本仓库 file 依赖；run 已能执行代码 assembly contribution，但尚没有 Electron 安装包制作、组合能力压缩脚本或插件 ZIP 安装工具。正式分发必须单独验证这些边界，不能把本地 build 成功当作发布完成。

JS SDK 的默认运行出口是 dist，`graphframework-source` 条件供能够加载 TypeScript 的源码宿主使用。仓库内 Vite/esbuild 明确绑定 SDK 源码；独立制品不得隐含依赖 GVSDK 的绝对路径或本仓库 source alias。Node_modules、Cargo target、缓存、密钥和用户数据不随插件交付。

SDK 和 Rust 微内核都不负责 Git 拉取、编译器定位、虚拟环境创建、依赖安装、构建、文件监听或进程守护。接收者的外层工具可以提供这些能力。generation 替换继续刻意丢弃旧 backlog、重置 State、使旧租约失效；不增加自动回滚、State 继承/迁移或跨代消息保留。

## 5. 独立目录发布验收

在仓库外的空目录执行，保留实际命令、平台、版本和测试结果：

1. 安装所发布 SDK、frontend/desktop 和目标平台 Rust 制品，不复制仓库 node_modules。
2. 解压正式插件 ZIP，检查 Manifest、OKF、公开契约、接入指南、完整文件清单与摘要。
3. 从任意目录启动已经准备好的 JS/Python worker，在同一 Rust daemon 中通过 Info 协作。
4. 核对 State/version、submission、Effect 成功/失败/取消、Agent inspect/inject/patch 与动态分析结果。
5. 更换 generation，确认旧 backlog 和 State 被刻意丢弃；新版本失败不自动恢复旧版本。
6. 按查询动态改变 folds/foldDepth，并在 admit/replace/evict 后核对分析快照更新。
7. 有前端的应用核对 Projection、显式插件装配、四主题、页面布局、浮动与联动。

演练不得读取 GVSDK 源码目录，也不要求插件位于固定位置。每个 operation 的 schema/黄金用例完整性、完整镜像矩阵、多平台制品和独立包演练都应作为独立验收项记录；当前契约文件数量或局部测试不能替代它们。

## 6. 性能与完成判据

执行热路径只维护必要的调度、revision 与有界事件，不解析分析事实或运行结构算法。分析按请求取得一致快照后计算，State 值变化不触发无关索引重建；Node/上下文/字段集合变化必须使相关缓存失效。见[常驻 Rust 图宿主协议](../protocols/kernel-daemon-protocol.md)。

性能验收使用相同机器、绑定构建模式、负载和轮数对比，区分 Rust/N-API 原始调度循环、宿主 change 与跨进程协议成本。基准命令与已有参考量级见[测试分层](../guides/testing.md)，不能从目录迁移推断性能已经无退化。

正式交付完成需要：各包可独立构建；公开消费通过包接口；共同协议与两套 SDK 验收通过；动态分析/Agent/刻意断代符合语义；独立目录和对应平台制品演练通过；性能无未解释退化；文档、摘要、兼容信息与制品一致；源码工作区干净且无旧路径兼容层。
