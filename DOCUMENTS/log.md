# Directory Update Log

## 2026-09-21
* **Update**: `DOCUMENTS/contracts/knowledge-root-sharing.md` 补首次启动三步（install.sh/install.ps1 安装分流、技能上游链接与 vendor 位置、AK 配置模板与 config list 验收、daemon/list 探活），真实 AK 只落 `~/.workbench/config.json` 不进文档。

## 2026-09-20
* **Architecture Restructure**: 实施文档体系“目标入口 → 决策模型 → 权威参考”三层结构重构：
  - 新建 `DOCUMENTS/goals/` 知识子包，包含 10 个端到端目标页（`first-setup.md`、`build-feature.md`、`integrate-external-world.md`、`build-ui.md`、`run-application.md`、`verify-change.md`、`debug-causal-flow.md`、`distribute-capability.md`、`evolve-kernel.md`、`add-language-runtime.md`）；
  - 重塑 `DOCUMENTS/README.md` 为唯一人工阅读目标入口，根 `README.md` 移除冗余任务表格直连文档中心，`DOCUMENTS/index.md` 明确作为 OKF 0.2 机器索引；
  - `AGENTS.md` §9 聚焦保留安全红线与合规守则，将新成员环境探测与安装教程完整抽离至 `goals/first-setup.md`；
  - 拆分原长篇 `guides/application-development.md` 至对应目标页，保留轻量总览与锚点重定向兼容层；
  - 将 `contracts/unified-run-plan.md` 归档为历史演进方案，解耦日常默认导航。
* **Architecture Specification**: 明确三层分包与应用复用规范：
  - 直接第三方标准依赖（playwright/numpy 等由 lockfile 管理，源码不入仓）；
  - 二次开发底层能力包（收敛至 `packages/<name>` 如 `packages/ufo`，零 GF 语义纯能力暴露，由 `EffectAdapter` 引入）；
  - 应用层复用铁律（重复业务实现做节点装配复用，不做包处理，`assembly.mjs` 按 ID 幂等去重）。
  - 同步更新 `DOCUMENTS/architecture/sdk-mental-model.md` 与 `DOCUMENTS/goals/integrate-external-world.md`。

* **Creation**: 交付能力包打包入口 `bash ./run.sh pack|verify|install`（`packages/tooling/run/src/package.mjs` + `cli.mjs`，无新增依赖）：发布侧生成确定性 ZIP 与 `.sha256` 并拒绝禁带内容；接收侧先校验文件名/摘要/形状/工厂引用，再做冲突预演，冲突或本地编辑时不修改 run；覆盖 `packages/desktop/host/p10-capability-share.test.mjs`（7 用例：确定性、摘要 mismatch、禁带、异目录安装、Node 冲突、本地编辑、原位更新）。业务入门与分发契约同步更新命令与三选一冲突解决。

* **Creation**: 新增仓库根 README 与业务开发默认入口，使用真实公开 API 串联 Node、插件、局部测试、run 装配、外部能力与前端接入。
* **Update**: 文档导航改为“业务任务优先、平台原理下钻”，明确 Kernel、协议和 SDK 心智模型不是普通业务开发的前置阅读。

## 2026-09-20
* **Update**: 重构文档体系为“目标入口 → 决策模型 → 权威参考”三层结构，建立 10 个目标指引页（`DOCUMENTS/goals/`）。
* **Update**: 规范三层分包（标准包、二次开发包 `packages/<name>`、应用层装配复用）与制品分发层级（基础软件更新包、工作流场景独立 run 分享、能力包 ZIP）。
* **Update**: 确立唯一主 run `runs/main`；确立“非核心插件不进入 `app/`”铁律，工作流插件通过 run 下插件（`runs/<name>/plugins/` 或 `runs/main/plugins/`）并入，绝不进入核心 `app/`。
* **Update**: 修复 Windows 环境下 `.cmd` 脚本由于 LF 换行导致的指令错位，统一为 CRLF 换行规范。

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
