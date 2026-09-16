---
type: guide
title: SDK 与插件分发验收契约
description: 镜像 SDK、独立制品、版本兼容、任意目录接入与性能验收的协作要求。
---

# SDK 与插件分发验收契约

本文件规定正式交付必须满足的要求，与[当前目录与分发边界](./package-distribution-restructure-plan.md)的实现说明分开。目录归位不等于制品已经通过独立发布验收。这里的制品清单不表示仓库存在自动打包、安装或发布流水线。

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

应用以 `application.json` 显式选择插件及路径。本仓库插件在 `app/plugins/`，外部插件可以位于其它目录。平台生产源码不得导入业务插件实现；插件不得相对导入另一个插件的内部源码。

正式插件仍是普通插件，只由指定发布者整体更新。接收方的自动化、工作流与团队定制放在自己的普通插件中，通过公开目标 Node 与定向 Info 协作。完整规则见[插件发布与协作契约](./plugin-collaboration-contract.md)。

发布插件的交付形状为：

```text
<plugin-id>/
  graphvideo.plugin.json
  PACKAGE.md
  backend.<语言扩展名>
  analysis/folds.recommended.json
  docs/INTEGRATION.md
  elements/                         需要用户操作时提供
  workspaces/                       需要工作区时提供
  frontend/ desktop/ resources/     按实际业务接入需要提供
```

这是正式交付要求，不是当前示例插件全部具备这些文件的声明。PACKAGE.md 使用 OKF，记录职责、发布者、公开 Info/Projection、兼容版本、整体更新限制、升级影响和摘要。推荐折叠文件覆盖该插件的全部基础 Node；完整应用的 folds 由消费方显式组合，不由 Rust 自动合并。

前端保持达芬奇色彩与排版语言、现有工作台切分/停靠/尺寸调整/浮动页面、刷新与页面联动。面板内部按钮、表单和业务命令由插件自行实现，不要求统一控件 DSL；无用户操作需求的后台插件无需前端。

## 3. 独立制品与兼容信息

按实际发布范围交付制品，并为每个制品提供独立版本、内容清单、SHA-256 和接入指南：

| 制品 | 格式与边界 |
| --- | --- |
| JavaScript SDK | `@graphvideo/sdk` npm tgz，七个子路径；发布消费需包含 dist 与适用的原生绑定 |
| Python SDK | `graphvideo-sdk` wheel/sdist，七个模块 |
| frontend / desktop | 按宿主生态交付源码包或构建制品，不属于 Python 镜像 |
| contract | 协议清单、黄金帧与发布兼容信息 |
| Rust daemon | 对应平台的可执行文件及启动/连接说明 |
| Rust C ABI | 动态库、头文件、协议版本与宿主 State 所有权说明 |
| Rust N-API | 按平台命名的 `.node` 及包内定位说明 |
| 普通业务插件 | 含 OKF、接入指南、推荐折叠配置的版本化 ZIP |
| 桌面应用 | 对应平台的 Electron 分发制品及 application 配置 |

发布清单记录 SDK、daemon、C ABI、N-API 与桌面宿主兼容版本，插件声明实际需要的最低版本。当前 desktop/frontend 使用源码和本仓库 file 依赖；没有 Electron 安装包制作或插件 ZIP 安装工具。正式分发必须单独验证这些边界，不能把本地 build 成功当作发布完成。

JS SDK 的默认运行出口是 dist，`graphvideo-source` 条件供能够加载 TypeScript 的源码宿主使用。仓库内 Vite/esbuild 明确绑定 SDK 源码；独立制品不得隐含依赖 GVSDK 的绝对路径或本仓库 source alias。Node_modules、Cargo target、缓存、密钥和用户数据不随插件交付。

SDK 和 Rust 微内核都不负责 Git 拉取、编译器定位、虚拟环境创建、依赖安装、构建、文件监听或进程守护。接收者的外层工具可以提供这些能力。generation 替换继续刻意丢弃旧 backlog、重置 State、使旧租约失效；不增加自动回滚、State 继承/迁移或跨代消息保留。

## 4. 独立目录发布验收

在仓库外的空目录执行，保留实际命令、平台、版本和测试结果：

1. 安装所发布 SDK、frontend/desktop 和目标平台 Rust 制品，不复制仓库 node_modules。
2. 解压正式插件 ZIP，检查 Manifest、OKF、公开契约、接入指南、完整文件清单与摘要。
3. 从任意目录启动已经准备好的 JS/Python worker，在同一 Rust daemon 中通过 Info 协作。
4. 核对 State/version、submission、Effect 成功/失败/取消、Agent inspect/inject/patch 与动态分析结果。
5. 更换 generation，确认旧 backlog 和 State 被刻意丢弃；新版本失败不自动恢复旧版本。
6. 按查询动态改变 folds/foldDepth，并在 admit/replace/evict 后核对分析快照更新。
7. 有前端的应用核对 Projection、显式插件装配、四主题、页面布局、浮动与联动。

演练不得读取 GVSDK 源码目录，也不要求插件位于固定位置。每个 operation 的 schema/黄金用例完整性、完整镜像矩阵、多平台制品和独立包演练都应作为独立验收项记录；当前契约文件数量或局部测试不能替代它们。

## 5. 性能与完成判据

执行热路径只维护必要的调度、revision 与有界事件，不解析分析事实或运行结构算法。分析按请求取得一致快照后计算，State 值变化不触发无关索引重建；Node/上下文/字段集合变化必须使相关缓存失效。见[常驻 Rust 图宿主协议](./kernel-daemon-protocol.md)。

性能验收使用相同机器、绑定构建模式、负载和轮数对比，区分 Rust/N-API 原始调度循环、宿主 change 与跨进程协议成本。基准命令与已有参考量级见[测试分层](./testing.md)，不能从目录迁移推断性能已经无退化。

正式交付完成需要：各包可独立构建；公开消费通过包接口；共同协议与两套 SDK 验收通过；动态分析/Agent/刻意断代符合语义；独立目录和对应平台制品演练通过；性能无未解释退化；文档、摘要、兼容信息与制品一致；源码工作区干净且无旧路径兼容层。
