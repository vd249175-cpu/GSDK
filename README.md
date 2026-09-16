---
type: guide
---

# GraphFramework (GSDK)

> **面向桌面与后端系统的因果应用微内核运行时（Causal Application Runtime）**<br />
> 强调显式因果推进、单一状态所有权、物理副作用隔离与确定性调度（Rust 调度微内核 + 开发者 SDK + Electron Workbench）。

本仓库采用纯源码工作区构建，不包含发包、tarball 导出或外围脚手架交付流程。事实顺序：源码与针对性测试 > `DOCUMENTS/mental-model.md` > 其他文档。

## 目录体系

- `app/` — GraphVideo 桌面应用与产品装配（Electron 生命周期、renderer、主进程物理宿主、显式插件装配）。
- `plugins/` — 可独立交付的普通业务插件（`graphvideo.studio`、`demo-topology`、`hello-counter`）。
- `packages/contract/` — JS/Python 共用的唯一协议事实源（schema、黄金帧、错误码、兼容矩阵）。
- `packages/sdk/javascript/` 与 `packages/sdk/python/` — 同一能力面的两种语言适配（`protocol/node/effect/plugin/analysis/agent/testing`）。
- `packages/frontend/` — JavaScript 专属前端能力（`client/workbench/tokens/ui`），无 Python 镜像。
- `packages/rust/` — Cargo workspace（`kernel/analysis/kernel-daemon/kernel-ffi/kernel-node`）；Rust crate 不得依赖 app、plugins 或语言 SDK。
- `packages/tooling/` — 开发工具包（`causal-visualizer/release`），不进入应用制品。
- `DOCUMENTS/` — 因果心智模型、协议、调试、测试与分析指南；入口见 [文档导航](./DOCUMENTS/README.md)。

## 核心开发命令

```bash
npm install
npm run typecheck        # tsc --noEmit（0 秒等待）
npm test                 # vitest run（sdk + unit + ui 全套单测）
npm run build:native     # 构建 Rust/N-API 调度内核并摆放本机原生产物
npm run test:app         # 本地应用单元测试
npm run verify:app       # 本地应用边界、类型、单测、因果诊断与构建全体验收
npm run refactor -- find-refs <file> <symbol>    # AST 符号全局引用定位
npm run refactor -- rename <file> <symbol> <new>  # AST 跨文件安全重命名
```

## 架构红线（摘要）

- `packages/sdk/javascript/src/node` 零业务、零 UI；`packages/frontend/workbench/` 零业务，不得导入具体业务插件。
- Node 间只用 `ctx.send(info, targetNodeId)`；每个 `Info.type` 必须在发送点静态可证明。
- State 唯一 Owner；纯领域 Node 零 I/O，物理经 `WorldNode` + 构造注入 `EffectAdapter`。
- Projection 是编码 DTO，读取必须经 `valueCodec.decode`。
- View 折叠契约在 JS SDK `analysis` 面；命名 view 的存储是消费方决定，不进 SDK。

