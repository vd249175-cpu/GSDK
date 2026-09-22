---
type: Developer Guide
title: Electron 桌面宿主开发入口
description: 唯一启动入口、九个公开子路径、窗口/IPC 安全边界、构建与测试门禁的自包含指南。
status: stable
tags: [desktop, electron, run-sh, public-api, renderer-security, ipc]
---

# Electron 桌面宿主开发入口 (`packages/desktop`)

本页是桌面宿主开发起点。读完即可选择公开模块、修改宿主服务并完成无头验证；业务窗口、preload 和面板内容仍由插件拥有。

## 1. 物理边界

`packages/desktop` 提供可复用的 Electron/Node 宿主能力，不保存业务状态，也不拥有具体录制器、业务窗口或 preload API：

- 业务事实来自 Kernel Projection，经 `valueCodec.decode` 后消费；renderer 不复制 State。
- 窗口动作通过构造注入的 EffectAdapter 执行。
- 每个前端插件可拥有自己的 `desktop/main.mjs` 与 `preload.cjs`；desktop 包只提供窗口配置、可信 sender 校验和 IPC gate。
- `host/main.mjs` 永远抛错，防止绕过 run 生命周期直接启动。

## 2. 唯一启动入口

开发 run 使用自己的稳定名称；正式集成只使用 `runs/main`：

```bash
bash ./run.sh start runs/<name>/run.config.json
bash ./run.sh status runs/<name>/run.config.json
bash ./run.sh stop runs/<name>/run.config.json
```

不得使用 `npm start`、`npm run dev`、`npx electron` 或直接执行插件 `desktop/main.mjs` 启动应用。`npm run build:*`、typecheck 和测试是无头开发命令，不等同于启动。

## 3. 九个公开子路径

包根没有 API。宿主与插件只从 `@graphframework/desktop/<capability>` 导入：

| 子路径 | 公开成员 | 用途 |
| :--- | :--- | :--- |
| `application` | `loadApplication`、`runtimeRoot` | 读取 legacy application assembly；run v2 仍由 tooling/run 装配 |
| `plugin-loader` | `loadBackendPlugins`、`loadFrontendPlugins` | 加载 application 中已启用插件 |
| `graph-host` | `createEmptyNativeGraphHost`、`createNativeGraphHost` | NativeRuleSpace 宿主、Node 生命周期与投影 |
| `agent-control` | `agentControlDiscoveryPath`、`startAgentControlServer` | 可信本地 Agent 控制面 |
| `command-gate` | `createCommandGate`、`bindCommandIpc` | renderer command allowlist 与读权限 |
| `element-catalog` | `ElementCatalog` | 插件 Element 元数据目录 |
| `electron-window` | `createElectronWindowAdapter` | Electron 窗口 EffectAdapter |
| `renderer-security` | `createRendererSecurity`、`secureIpc` | 顶层文档信任、导航阻断、IPC sender 校验 |
| `window-options` | `createWorkbenchWindowOptions` | 安全默认 `webPreferences` 与 preload 路径装配 |

源码模块由 `package.json#exports` 统一发布。`graph-host` 和 `element-catalog` 在 `build:main` 时生成对应 `.js` 产物；开发测试通过 alias 直接使用 `.mjs` 源码。禁止从 `host/**` 深层路径导入。

## 4. 窗口与 IPC 安全

创建窗口时组合安全 helper，而不是在业务插件中复制选项：

```js
import { createWorkbenchWindowOptions } from '@graphframework/desktop/window-options'
import { createRendererSecurity, secureIpc } from '@graphframework/desktop/renderer-security'

const options = createWorkbenchWindowOptions({ preloadPath, iconPath })
const security = createRendererSecurity({ rendererEntryUrl })
security.trustWindow(mainWindow)
const ipc = secureIpc(ipcMain, security)
```

安全契约：`contextIsolation` 开启；renderer 无 Node 集成；只有被信任主窗口的当前 top-level document 可以调用 IPC；跨 URL 导航、redirect、webview 和子窗口导航均被阻断。插件 preload 只能暴露最小 DTO 方法，不得暴露 `ipcRenderer`、filesystem 或 Electron 对象本身。

## 5. 开发流程

1. 确认改动属于通用宿主；具体业务功能放在 `runs/<name>/plugins` 或已批准的核心插件。
2. 从上表选择现有能力面。新增公共能力时先新增独立模块，再同步 `package.json#exports`、测试 alias、TS path 与本表。
3. 先写对应 `*.test.mjs`；窗口行为使用 fake，不启动 Electron 肉眼测试。
4. 运行针对性测试和强制门禁：

```bash
npm --prefix packages/desktop test -- packages/desktop/application.test.mjs --silent
npm --prefix packages/desktop run check:renderer-boundary
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
npm --prefix packages/desktop run build:main
```

只有修改原生绑定装载时才额外运行：

```bash
npm --prefix packages/desktop run verify:native-load
```

完成标准：没有业务语义进入宿主；所有公共导入经过 exports 子路径；renderer 不能越过 IPC/Node 边界；构建产物与源码导出一致；应用启动仍只能经 `run.sh`。
