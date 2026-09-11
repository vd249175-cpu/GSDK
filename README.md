# GraphVideo SDK

独立 SDK 开发仓：微内核（`kernel/`）、开发者套件（`sdk/`）、工作台底座（`workbench/`）、最小可跑模板（`templates/local-app/`）。事实顺序：源码与针对性测试 > `DOCUMENTS/mental-model.md` > 其他文档。

## 目录

- `kernel/` — `@graphvideo/kernel`：零业务语义微内核（mailbox/change 调度、State、Projection）。
- `sdk/` — `@graphvideo/sdk` + `@graphvideo/backend-sdk`：插件 Manifest、测试 Runtime、analysis（因果索引/折叠契约）、contract、client/tokens/ui、冷启动 `graphvideo-init` bin。
- `workbench/` — `@graphvideo/workbench`：零业务语义的前端工作台底座，不得导入具体业务插件。
- `templates/local-app/` — 最小可跑应用，仓外验收用。
- `scripts/` — `build-packages.mjs`（构建四包）、`export-packages.mjs`（组装 `dist/delivery` 并跑仓外验收）。
- `DOCUMENTS/` — 仅保留 SDK 相关心智模型与指南。

## 命令

```bash
npm install
npm run typecheck        # tsc --noEmit
npm test                 # kernel + unit + ui
npm run build:sdk        # 构建四个包（kernel/backend-sdk/sdk/workbench）
npm run export:sdk       # 构建 + 组装 dist/delivery + 仓外三验收
```

## 红线（摘要）

- `kernel/src` 零业务，不得导入业务代码；`workbench/` 不得导入具体业务插件。
- Node 间只用 `ctx.send(info, targetNodeId)`；每个 `Info.type` 必须在发送点静态可证明。
- State 唯一 Owner；纯领域 Node 零 I/O，物理经 `WorldNode` + 构造注入 `EffectAdapter`。
- Projection 是编码 DTO，读取必须经 `valueCodec.decode`。
- View 折叠契约（`FoldDefinitionFile`/`AnalysisView` 等）在 `sdk/analysis`；命名 view 的存储是消费方决定，不进 SDK。
