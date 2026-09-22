---
type: Developer Guide
title: Microsoft UFO 接入开发入口
description: 上游 UFO submodule、GraphFramework 插件桥、环境配置、运行边界和验证方式。
status: stable
tags: [ufo, windows, submodule, computer-control, effect-adapter]
---

# Microsoft UFO 接入开发入口

`packages/ufo` 是固定版本的上游 Microsoft UFO Git submodule，当前指向 v3.0.9；它不是 GraphFramework 的公开 API，也不承载 Node/Info 语义。GraphFramework 接入代码位于 `app/plugins/backend/ufo-computer-control/`，开发者通常只修改该插件，不直接修改 submodule。

## 1. 组件边界

| 位置 | 所有权 | 职责 | 公开入口 |
| :--- | :--- | :--- | :--- |
| `packages/ufo/` | Microsoft 上游 submodule | UIA、截图、Puppeteer command 实现 | 上游 Python package |
| `app/plugins/backend/ufo-computer-control/index.mjs` | GraphFramework | session/execution/observation 三 Node 与 graph factory | 插件包根 |
| `bridge/ufo-computer-bridge.mjs` | GraphFramework | Node EffectAdapter ↔ 常驻 Python worker JSONL 桥 | 插件根及 `./bridge` |
| `bridge/ufo-computer-worker.py` | GraphFramework | 将便携 JSON 请求映射为上游 UFO 对象调用 | 仅由 bridge 拉起 |
| `runs/main/host.mjs` | 主 run 宿主 | 构造 bridge 并向实例注入两个 adapters | 仅由 `run.sh` 生命周期调用 |

领域 session 不接触 Python、UIA、文件系统或时钟。ExecutionWorldNode 只下发动作；ObservationWorldNode 只读取窗口、控件、截图和 UI tree；只有宿主构造的 EffectAdapter 可以接触物理桌面。

## 2. 环境准备

```bash
git submodule update --init packages/ufo
python -m venv packages/ufo/.venv
packages/ufo/.venv/Scripts/python.exe -m pip install -r app/plugins/backend/ufo-computer-control/bridge/ufo-ui-requirements.txt
```

`runs/main/run.config.json` 当前通过 `backend.dependencies.ufoDirectory` 与 `ufoPythonExecutable` 指向该环境。不得把凭据写入 submodule、run 配置或插件；UFO UI 控制本身不需要为仓库保存账号凭据。

## 3. 开发入口

插件的完整 Info、action、observation、State 和 bridge 契约见 [UFO Computer Control 插件手册](../../plugins/ufo-computer-control.md)。最小开发循环只使用 mock adapters：

```bash
npm --prefix packages/desktop test -- app/plugins/backend/ufo-computer-control/tests/backend.test.mjs --silent
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
```

只有明确需要真机验收时才通过 `bash ./run.sh start runs/main/run.config.json` 启动；UFO、Windows 步骤录制器和其他桌面控制必须串行独占前台桌面。未经用户明确要求，不为验证环境而启动主 run 或 Python worker。

完成标准：submodule 版本不被无意改动；插件只从包根暴露接口；执行/观察物理分离；所有异常转换为 Info；mock 测试无需桌面即可通过；真机过程只走命名 run。
