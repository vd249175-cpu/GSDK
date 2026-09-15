---
type: guide
title: 插件发布与协作契约
description: 统一插件交付、所有权、跨插件协作、折叠建议和可选前端的发布规则。
---

# 插件发布与协作契约

## 1. 只有一种插件

协作交付中的插件与仓库现有插件完全相同：都使用 `graphvideo.plugin.json`、Plugin SDK、普通 Node、相同装载方式和相同生命周期。内核不区分核心插件、扩展插件或工作流插件，也不为发布者拥有的插件提供额外权限。

“核心插件”只表示该插件由指定发布者维护，是一个有明确职责和公开契约的正式交付物。例如，浏览器操作录制插件可以拥有录制控制领域 Node、浏览器事件 `ObservationWorldNode`、必要的 `ExecutionWorldNode`，以及确实用于录制操作的可选前端。这个名称不表示 Rust 微内核的一部分。

## 2. 所有权与禁止污染

发布者交付的正式插件目录是一个整体版本制品。接收方只能用发布者提供的新版本整体更新，不得在原目录中继续添加或修改业务能力。

接收方不得：

- 修改正式插件的 Node、State、Info、Adapter、Element、Workspace 或构建文件；
- 在正式插件目录中追加自己的 Node、自动化流程、前端或业务文档；
- 导入、继承或复制正式插件未声明为公开契约的内部实现；
- 直接读取或修改其它插件的 State，或者复用其它插件的 Node ID；
- 把独立业务需求作为补丁持续并入正式插件，使其职责无边界增长。

发布者可以在插件原有职责内发布修复和演进版本。与该职责无关的自动化、项目流程和团队定制应成为新的插件，而不是扩大原插件。

## 3. 通过另一个普通插件扩展

同事需要在既有能力上继续开发时，应创建具有独立插件 ID、版本、目录和 Node 命名空间的普通插件。例如，浏览器录制自动化应由 `recording-automation` 插件中的策略和调度 Node 实现，而不是修改 `browser-recorder` 插件。

插件之间只通过明确的定向 Info 协作：

```text
recording-automation Node
  └─ ctx.send(StartRecordingRequestedInfo, browser-recorder.control)
       └─ browser-recorder 在自己的 change 中修改自己的 State
```

每个 State 字段仍只有一个 Owner。接入方只能向被发布插件公开的目标 Node 发送公开 Info，并按其 payload 契约处理结果。内部 Info、内部 Node、State schema 和 Adapter 不因代码可见而成为公开 API。需要新的协作入口时，由原插件发布者在新版本中明确增加。

同事互相传递的自动化工作流，只要包含 Node 或运行逻辑，就仍然作为普通插件交付。纯参数、提示或静态配置可以作为该插件的资源；不得为此在内核中增加另一套工作流本体或通信机制。

## 4. 发布包的 OKF 说明

每个正式插件包必须包含 `PACKAGE.md`。它是 OKF 0.2 文档，至少具有非空 `type`，并在正文中声明插件职责、发布者、公开契约、版本兼容性和修改边界。推荐使用以下 frontmatter：

```yaml
---
type: package
title: Browser Recorder
description: 浏览器操作录制插件
package_id: example.browser-recorder
package_version: 1.0.0
maintainer: example-team
update_policy: publisher-replace-only
downstream_modification: forbidden
---
```

`package_id`、`package_version` 必须与 `graphvideo.plugin.json` 一致。`update_policy: publisher-replace-only` 和 `downstream_modification: forbidden` 表示接收方只能安装发布者提供的完整新版本，不能在包内继续开发。

`PACKAGE.md` 正文至少列出：

- 插件唯一职责和明确不承担的职责；
- 全部公开目标 Node、可接收 Info、payload 约束和公开 Projection；
- 对外发送的 Info 及其目标约定；
- 内部实现边界；
- 依赖的 Plugin API、宿主能力和最低兼容版本；
- 是否提供前端，以及提供前端的用户操作理由；
- 升级时可能发生的 Node generation、State 和待处理 Info 变化；
- 发布者、问题反馈入口和制品完整性校验方式。

发布包还应包含接入指南，说明如何装配插件、提供依赖、连接公开 Info、运行针对性测试、检查因果分析，以及如何整体替换版本。目录发现、安装、构建和文件监听仍由外层宿主或团队工具负责，不进入 Rust 微内核。

## 5. 推荐折叠配置

插件应随包提供自身 Node 的推荐折叠层级，用于说明职责边界。推荐分辨率为：

- `foldDepth: 0`：把整个插件视为一个能力；
- `foldDepth: 1`：展开为领域、执行、观察和集成等职责组；
- `foldDepth: 2` 及更深：继续展开到具体基础 Node。

同一推荐层级中的每个基础 Node 必须且只能出现一次；组 ID 应稳定，且不能与 Node ID 冲突。折叠只改变分析分辨率，不改变运行拓扑、State 所有权或 Info 路由。

`FoldDefinitionFile` 必须覆盖被分析图中的全部 Node，所以单个插件随包提供的是该插件范围内的推荐配置。多个插件共同装配后，应用装配层或协作插件维护者需要把各插件建议组合成覆盖完整生产图的产品级配置；内核不会自动合并局部折叠文件。

## 6. 前端只服务于用户操作

插件只有在需要用户发起操作、输入参数或作出决定时才贡献 Element 或 Workspace。后台自动化、观察和纯策略插件默认不增加前端。

需要前端时沿用当前达芬奇工作台模式：组件消费 Workbench 语义 Token，保持专业、高密度的桌面布局，并支持现有主题。renderer 只发送固定的用户意图并读取 Projection；不得指定任意 Node/Info、直接修改 State、执行 Node 或调用物理 Adapter。

前端是否存在不改变插件之间的协作方式。前端发出的用户命令经 `rendererRoots` 白名单进入图，插件之间仍只使用 `ctx.send(info, targetNodeId)`。

## 7. 版本更新语义

插件版本使用 SemVer，交付文件以插件 ID 和版本命名。正式更新是完整制品替换，不是在接收方目录上叠加文件。

运行中的 Node generation 替换仍遵守内核现有的刻意断代语义：等待单飞间隙后丢弃旧 mailbox backlog、使旧租约失效，并由新实例从自己的初始 State 启动。内核不提供新版本失败自动回滚、State 自动迁移、无缝切换或跨 generation 消息保留。需要数据恢复时，由插件通过显式 Info 和业务协议实现，并写入接入指南。

建议发布者为 ZIP 或目录清单提供 SHA-256 摘要。接收方应在安装和升级前核对摘要，并把本地额外文件或摘要变化视为插件污染；团队定制内容必须迁移到独立插件后再更新正式包。

## 8. 交付验收

发布或转交前至少确认：

1. `graphvideo.plugin.json`、后端插件 ID 和 `PACKAGE.md` 中的 ID、版本一致；
2. Node ID 在完整装配中唯一，公开入口只包含明确的用户意图；
3. 每条 `ctx.send` 的 Info 类型和目标可静态证明；
4. State 只由 Owner Node 在当前 change 中写入；
5. 执行类与观察类 WorldNode 物理分离；
6. 推荐折叠配置没有未知、重复或遗漏的 Node；
7. 前端确实承担用户操作，并遵守达芬奇工作台与 Projection 边界；
8. 针对性测试、类型检查和因果索引校验通过；
9. 接入指南记录依赖、公开契约、升级影响和验证命令；
10. 正式包中不存在 `node_modules`、构建缓存、密钥、用户数据或接收方定制代码。

相关运行规则见 [Plugin SDK 当前边界](./plugin-sdk-guide.md)、[当前心智模型](./mental-model.md)、[实例因果分析](./causal-analysis.md)和[Workbench 设计系统](./design-system.md)。
