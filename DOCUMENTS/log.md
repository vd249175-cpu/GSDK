# Directory Update Log

## 2026-09-20
* **Creation**: 新增仓库根 README 与业务开发默认入口，使用真实公开 API 串联 Node、插件、局部测试、run 装配、外部能力与前端接入。
* **Update**: 文档导航改为“业务任务优先、平台原理下钻”，明确 Kernel、协议和 SDK 心智模型不是普通业务开发的前置阅读。

## 2026-09-19
* **Update**: 在 `AGENTS.md` 加入新成员开发环境初始化、原生构建、飞书 CLI/Skills 安装、`user-default` 授权与个人知识库索引验收流程。
* **Update**: 明确同一工作流采用原页面与原能力 ID 的更新替换语义，不并行追加新版 assembly；基础软件批量发布必须由统一打包脚本生成，当前脚本仍待交付。
* **Update**: 确立飞书双通道分享策略：知识与工作流正文进入共同维护的知识库，版本化 assembly 能力 ZIP 经指定群聊分发，核心软件继续批量更新。
* **Update**: 引入可分享的 run 代码装配贡献，统一表达插件、Node/Graph 工厂、绑定、前端实例和既有 Node 依赖；相同定义自动去重，冲突在启动前报告。
* **Update**: 明确 JS 静态因果事实只通过 TypeScript AST 与实例数据生成，禁止使用正则、源码子串或括号计数推导关系。
* **Update**: 记录 `mountDomainNode` 生成 `PortableAnalysisSnapshot`、Rust 保存事实、`readStaticTopology` 仅聚合已保存 send 证据的边界。
* **Update**: 补充可证明的 `Info.type` / send 语法、无法证明时的诊断行为及 topology 缺边排查入口。

## 2026-09-18
* **Update**: 重构 `DOCUMENTS/` 为分层 OKF 0.2 知识包，建立 `architecture/`、`protocols/`、`guides/`、`contracts/`、`diagnostics/` 和 `standards/` 语义子目录。
* **Update**: 为全量概念文档补充完整 YAML Frontmatter（包含 `type`、`title`、`description`、`status`、`tags`）。
* **Creation**: 建立根目录与各子目录 `index.md`，支持 OKF 渐进式披露（Progressive Disclosure）。
* **Creation**: 建立标准更新日志 `log.md`。
* **Update**: 为 `SPEC.md` 补全合规 Frontmatter，确立格式规范基准。

## 2026-09-16
* **Update**: Stage 4 tooling 归位与根目录收口，规范 `DOCUMENTS/agent-guides/` 技能归属。
* **Update**: 统一微内核调度至 Rust 原生微内核，退役 TS 双内核演进。

## 2026-09-14
* **Creation**: 确立多 Agent 独立开发运行规范与统一 run 实施计划。
