# 本地应用模板

最小仓外 Electron + Vite + React 应用，只消费 `@graphvideo/*` 发布入口。

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
```

`diagnose` 只用发布入口 `@graphvideo/sdk/analysis` 对自身插件建索引，
只读实例描述，不创建生产 Runtime、不启动应用。WorldNode 构造注入可替换
Adapter 的演示见 `backend.test.mjs` 测试夹具（SaverNode），不进生产装配。

## 并发语义（本模板的演示边界）

- 跨节点并行：一次 `inject` 触发的 `send` 扇出后，各目标 Node 的 change 可并发推进。
- 单节点串行：同一 Node 的 change 严格 single-flight；并发 `IncrementInfo` 在 `example.counter` 排队，State 不撕裂。
- 依据见 `DOCUMENTS/mental-model.md` §9 公理 4；因果用 `npm run diagnose -- change example.counter::IncrementInfo` 查看。
- 本模板只演示最小链路（counter 自增 + 前后端读写）；多节点扇出/扇入按上述公理自行扩展。

## 目录职责
- `src-main/`：宿主入口，唯一 Runtime 所有者（`graph-host.mjs` 常驻，测试用 `createTestRuntime` 同构）。对外只暴露固定命令（`counter/increment`、`counter/state`）：写入经插件 `rendererRoots` 授权，读取走 Projection 派生 DTO；renderer 不得指定任意 Node/Info。窗口三键是图外桌面服务（`window:minimize/toggle-maximize/close` 直调 BrowserWindow，不进图），无边框样式见 `renderer/src/app.css`。`native-graph-host.mjs` 是原生规则空间对照宿主（Rust 调度 + 同一插件 Node，`hotSwap` 热替换演示，读数走规则空间状态拷贝；见下节矩阵）。
- `plugins/hello-counter/`：业务插件，`backend.mjs` 提供 Node，`graphvideo.plugin.json` 声明。
- `products/default.json`：产品组合（主题默认 + 插件列表）。
- `renderer/`：Vite/React 前端，只读投影经 preload 白名单通道，不触 Kernel。样式只消费 `@graphvideo/workbench` 语义 Token（`app.css` 为模板自有）；顶栏主题切换（深色/浅色/雪青/石榴裙）是本地 UI 态，存 `localStorage`。
- `analysis/`：项目分析配置占位。
- `scripts/`：消费项目自带检查（renderer 边界）。

## 复用清单

| 复用项 | 来源 | Owner | 消费者 | 生命周期 | 公开入口 |
| --- | --- | --- | --- | --- | --- |
| `Node` / `defineBackendPlugin` | `@graphvideo/backend-sdk` | 插件 | `plugins/*/backend.mjs` | 进程常驻 | `backend-sdk` index |
| `KernelRuntime`（仅 main） | `@graphvideo/kernel` | 宿主 | `src-main/graph-host.mjs` | 进程常驻 | `kernel` index |
| `NativeRuleSpace` + `mountDomainNode`（仅 main） | `@graphvideo/backend-sdk` | 宿主 | `src-main/native-graph-host.mjs` | 进程常驻 | `backend-sdk` index |
| Rust 调度内核 | `graphvideo-kernel-node`（`npm run build:native` 构建） | 宿主 | `NativeRuleSpace` 经 napi 加载 | 进程常驻 | staged `.node` |
| `createTestRuntime`（仅测试） | `@graphvideo/sdk/testing` | 插件测试 | `*.test.mjs` | 单次测试 | `sdk/testing` |
| 工作台样式 | `@graphvideo/workbench/styles.css` | renderer | `renderer/src/app.tsx` | 前端构建期 | `workbench` styles.css |
| `parseStudioPluginManifest` 约束（如需） | `@graphvideo/sdk/contract` | 插件 | manifest 校验 | 构建/测试期 | `sdk/contract` |

## 原生规则空间演示与支持矩阵

```bash
npm run build:native                                   # 构建 + 摆放到 crates/kernel-node/
npx vitest run src-main/native-graph-host.test.mjs     # M4 热重载演示（需 .node 存在否则跳过）
```

演示覆盖：生产插件跑在 Rust 调度上；不重启进程热换 v2（旧 backlog 丢弃、
新实体纯净启动、显式 Info 恢复、新步长生效、代次 +1）。

| 目标 | 状态 |
| --- | --- |
| win32-x64-msvc（debug 构建，`scripts/stage-native.mjs` 摆放） | ✅ Node.js 25（ABI 141）加载 + 调度已验证，含仓外目录独立加载 |
| Electron 33 主进程加载 | ❌ 未验证（仅验证 `electron --version` 二进制存在） |
| 其他 OS/架构、release 构建 | ❌ 未提供（stage 脚本仅 win32-x64-msvc debug） |
| 性能基线/资源曲线 | ❌ 未测量 |
| tarball 交付与 `graphvideo-init` 冷启动链 | ❌ 无配套根脚本，见开发规划 §8 剩余事项 |

## 使用

```bash
# 方式一：一键冷启动（推荐）
# 先一次装齐四包（bundle 内 tarball 本地满足，离线可装；另需 react 系常规依赖走 registry）
mkdir my-app && cd my-app && npm init -y
npm install /path/to/delivery/packages/*.tgz
npx graphvideo-init . --skip-install
npm install && npm run verify

# 方式二：在已装好 @graphvideo/sdk 的任意目录建新应用（自动装包）
npx graphvideo-init my-app --name my-app
cd my-app && npm install && npm run verify
```

声明检查（原仓库源码不可用时仍可完成）：

```bash
npm run verify   # 边界 + 类型 + 测试 + 自诊断 + 构建
```

人工验收（Agent 不启动桌面应用）：`npx electron .` 启动、切页保留实例、布局恢复、退出清理。
