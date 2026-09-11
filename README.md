---
type: guide
---

# GraphFramework (GSDK)

> **面向桌面与后端系统的因果应用微内核运行时（Causal Application Runtime）**<br />
> 强调显式因果推进、单一状态所有权、物理副作用隔离与确定性调度（Rust 调度微内核 + 开发者 SDK + Electron Workbench）。

本仓库采用纯源码工作区构建，不包含发包、tarball 导出或外围脚手架交付流程。事实顺序：源码与针对性测试 > `DOCUMENTS/mental-model.md` > 其他文档。

## 目录体系

- `crates/kernel` & `crates/kernel-node` — **生产调度微内核**：Rust 原生实现（Mailbox、Generation、Single-flight 调度、有界准入与热替换、确定性投递结算）；通过 N-API 提供原生绑定。
- `core/` — `@graphvideo/kernel`：零业务语义核心规约与类型契约（Node、WorldNode 物理隔离、Info 协议、Context 能力、Projection 编解码）。TS 运行时冻结为参考规约（Executable Specification / Test Oracle），生产主干统一收敛至 Rust 原生内核。
- `sdk/` — `@graphvideo/sdk`：通用开发者套件与门面：
  - `sdk/backend/`：原生规则空间（`NativeRuleSpace`）、后端插件 Manifest 与 Node 挂载桥接。
  - `sdk/client/`：前端投影订阅与通信管道。
  - `sdk/workbench/`：零业务语义的前端工作台底座（AreaShell、Workspace、Dock、面板与窗口管理）。
  - `sdk/testing/`：测试运行时与 EffectHarness。
  - `sdk/analysis/`：因果索引与静态拓扑健康诊断。
  - `sdk/contract/` & `tokens/` & `ui/`：设计规范与共享组件。
- `apps/local-app/` — 本地 Electron 落地工程（主进程直连 `NativeRuleSpace`，Vite/React renderer 仅读取投影 DTO）。
- `scripts/` — 核心工程工具：`refactor.mjs`（基于 TS LanguageService 的全局 AST 符号重构与重命名）与原生构建辅助。
- `DOCUMENTS/` — 因果心智模型、调试、测试、分析与设计指南；入口见 [文档导航](./DOCUMENTS/README.md)。

## 核心开发命令

```bash
npm install
npm run typecheck        # tsc --noEmit（源码直连穿透检查，0 秒等待）
npm test                 # vitest run（core + unit + ui 全套单测）
npm run build:native     # 构建 Rust/N-API 调度内核并摆放本机原生产物
npm run build:runtime    # 生成 Electron 可加载的 Kernel/backend 本地运行时
npm run test:core        # 微内核针对性单测
npm run test:unit        # SDK 单元测试
npm run test:ui          # Workbench UI 前端测试
npm run test:app         # 构建本机运行时后执行本地应用单元测试
npm run verify:app       # 本地应用边界、类型、单测、因果诊断与构建全体验收
npm run refactor -- find-refs <file> <symbol>    # AST 符号全局引用定位
npm run refactor -- rename <file> <symbol> <new>  # AST 跨文件安全重命名
```

## 架构红线（摘要）

- `core/src` 零业务、零 UI，不得导入任何浏览器/DOM 依赖；`sdk/workbench/` 零业务，不得导入具体业务插件。
- Node 间只用 `ctx.send(info, targetNodeId)`；每个 `Info.type` 必须在发送点静态可证明。
- State 唯一 Owner；纯领域 Node 零 I/O，物理经 `WorldNode` + 构造注入 `EffectAdapter`。
- Projection 是编码 DTO，读取必须经 `valueCodec.decode`。
- View 折叠契约（`FoldDefinitionFile`/`AnalysisView` 等）在 `sdk/analysis`；命名 view 的存储是消费方决定，不进 SDK。
