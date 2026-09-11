---
type: guide
---

# 本地应用

仓库内最小 Electron + Vite + React 应用。它通过 npm workspace 使用当前源码；主进程运行 `NativeRuleSpace`，renderer 只通过 preload 白名单调用固定命令并读取投影 DTO。

## 自诊断

```bash
npm run diagnose -- validate
npm run diagnose -- node example.counter
npm run diagnose -- change example.counter::IncrementInfo
npm run diagnose -- info IncrementInfo@example.counter
npm run diagnose -- state example.counter::count
npm run diagnose -- path state:example.counter::count change:example.counter::IncrementInfo
npm run diagnose -- select example.counter
npm run diagnose -- frontend
npm run diagnose -- health
npm run diagnose -- reach example.counter
```

`diagnose` 使用 `@graphvideo/sdk/analysis` 对自身插件建索引，
只读实例描述，不创建生产 Runtime、不启动应用。WorldNode 构造注入可替换
Adapter 的演示见 `backend.test.mjs` 测试夹具（SaverNode），不进生产装配。

## 并发语义（本模板的演示边界）

- 单节点串行：同一 Node 的 change 严格 single-flight；并发 `IncrementInfo` 在 `example.counter` 排队，State 不撕裂。
- change 内并发：一个 WorldNode change 可以通过 `Promise.all` 并发等待多个互不依赖的 EffectAdapter，再集中写入 State。
- 外部任务并行：一个 Node 可提交多个同时在途的物理任务；Node 数量不等于外部任务并发度。
- 当前原生桥边界：Rust 可独立调度不同实体，但 `NativeRuleSpace` 的 JS pump 当前逐个等待 handler；本模板不宣称多个 JS change 回调同时执行。
- 依据见 `DOCUMENTS/mental-model.md` §8 公理 4；因果用 `npm run diagnose -- change example.counter::IncrementInfo` 查看。
- 本模板只演示最小链路（counter 自增 + 前后端读写）；多节点扇出/扇入仍通过定向 Info 表达。

## 目录职责
- `src-main/`：宿主入口与唯一 Runtime 所有者。`main.mjs` 使用 `native-graph-host.mjs`；`graph-host.mjs` 保留为 TypeScript KernelRuntime 的对照与测试宿主。写入经插件 `rendererRoots` 授权，读取走 Projection/EncodedValue；renderer 不得指定任意 Node/Info。窗口三键是图外桌面服务，直接调用 BrowserWindow。
- `plugins/hello-counter/`：业务插件，`backend.mjs` 提供 Node，`graphvideo.plugin.json` 声明。
- `products/default.json`：产品组合（主题默认 + 插件列表）。
- `renderer/`：Vite/React 前端，只读投影经 preload 白名单通道，不触 Kernel。样式只消费 `@graphvideo/workbench` 语义 Token（`app.css` 为模板自有）；顶栏主题切换（深色/浅色/雪青/石榴裙）是本地 UI 态，存 `localStorage`。
- `analysis/`：项目分析配置占位。
- `scripts/`：消费项目自带检查（renderer 边界）。

## 复用清单

| 复用项 | 来源 | Owner | 消费者 | 生命周期 | 公开入口 |
| --- | --- | --- | --- | --- | --- |
| `Node` / `defineBackendPlugin` | `@graphvideo/backend-sdk` | 插件 | `plugins/*/backend.mjs` | 进程常驻 | `backend-sdk` index |
| `KernelRuntime`（参考与测试） | `@graphvideo/kernel` | 宿主 | `src-main/graph-host.mjs` | 单次测试 | `kernel` index |
| `NativeRuleSpace` + `mountDomainNode`（生产 main） | `@graphvideo/backend-sdk` | 宿主 | `src-main/native-graph-host.mjs` | 进程常驻 | `backend-sdk` index |
| Rust 调度内核 | `graphvideo-kernel-node`（`npm run build:native` 构建） | 宿主 | `NativeRuleSpace` 经 napi 加载 | 进程常驻 | staged `.node` |
| `createTestRuntime`（仅测试） | `@graphvideo/sdk/testing` | 插件测试 | `*.test.mjs` | 单次测试 | `sdk/testing` |
| 工作台样式 | `@graphvideo/workbench/styles.css` | renderer | `renderer/src/app.tsx` | 前端构建期 | `workbench` styles.css |
| `parseStudioPluginManifest` 约束（如需） | `@graphvideo/sdk/contract` | 插件 | manifest 校验 | 构建/测试期 | `sdk/contract` |

## 原生规则空间与验证

```bash
npm run build:native
npm run build:runtime   # 生成共享的 Kernel/backend Electron 运行时
npm run verify:app
npx vitest run apps/local-app/src-main/native-graph-host.test.mjs --silent
```

验证覆盖：生产插件运行在 Rust 调度上；Electron 真实导入 backend runtime 与原生绑定；热替换等待当前 change 的单飞间隙，丢弃旧 backlog，新实体从纯净初值启动并增加 generation；Projection 使用 EncodedValue，revision 单调增加；WorldNode EffectAdapter 接收 Clock 与 submission AbortSignal。

| 目标 | 状态 |
| --- | --- |
| win32-x64-msvc debug 与 release | 已验证 Node.js 25 加载、调度与测试 |
| Electron 33 主进程加载 | 已验证实际 `@graphvideo/backend-sdk` 导入、调度、投影与清理 |
| linux / macOS 与其他架构 | stage 命名已实现，尚未在对应机器执行 |
| 原生调度基线 | release 绑定、20,000 change × 5 轮：约 21.3–23.2 万 change/s；空闲实体替换 p50 0.6µs、p95 0.9µs、p99 1.2µs。该数据只衡量 Rust/N-API 原始循环，不代表完整业务链路 |

## 使用

```bash
npm install
npm run verify:app
```

只验证本地应用时：

```bash
npm --prefix apps/local-app run verify
```

人工验收（Agent 不启动桌面应用）：`npx electron .` 启动、切页保留实例、布局恢复、退出清理。
