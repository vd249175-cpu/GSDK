---
type: guide
title: 桌面冒烟测试 SOP
description: 录制 unified-1790148389684 提炼的桌面冒烟流程、参数与补偿。
---

# 桌面冒烟测试 SOP（录制 unified-1790148389684）

来源：`runs/main/.generated/data/recordings/2026-09-23_16-26-29__2026-09-23_16-26-53_unified-1790148389684`
（17 步、24 秒、纯桌面事件；解说为空，键盘输入原文未捕获，`native/browser-playwright.js` 为空）。

## 意图

`RunDesktopSmokeTest(npmUrl, docName, docText)`：验证一台 Windows 桌面能完成“浏览器主页可达 + Word 文档可编辑保存 + 回到 GraphFramework”的最小闭环。

## 步骤

1. 浏览器检查：直达 `npmUrl`（默认 `https://www.npmjs.com/`），关闭通知横幅，确认主页加载。
   录制中经书签逐级点开（书签栏→“开发”文件夹→npm 书签），提纯为直接导航，语义等价。
2. 文档编辑：双击打开 `docName`（默认 `开发步骤.docx`），聚焦正文，输入 `docText`，关闭并确认保存。
3. 桌面观察：确认前台回到 GraphFramework 窗口，记录窗口清单与观察时间，结算 `done`。

## 噪声（已剔除）

- `about:blank` 重复点击（Step 04/05 只保留一次语义）。
- 任务栏 Chrome/Electron 来回聚焦（Step 01/02/16/17），只保留最终“回到 GraphFramework”观察断言。
- OpenRouter Credits 标签页停留，无后续操作，视为误触。

## 参数与前置

- 前置：Windows 桌面已登录；Chrome 可用；`docName` 存在于可打开位置；GraphFramework 客户端在运行。
- `docText` 为必填动态输入：录制键盘事件正文为空（`[...]`），回放时必须显式传入，不得编造原文。
- 关键确认点：npm 主页已加载、文档已保存（保存对话框已确认）、前台窗口为 GraphFramework。

## 补偿

- 任一执行失败 → 会话 `status=error`，`lastError` 记录阶段与原因，不继续后续步骤。
- Word 保存对话框卡住 → 按失败处理，需人工在前端监视窗口确认后重跑。

## 操作观察与 Agent 断点

当前 `run.config.json` 的启动请求带 `skipDocEdit: true`：默认验证浏览器主页，再通过 UFO `focus_window` 聚焦标题包含 `desktopWindowTitle`（默认 `GraphFramework`）的窗口，随后独立观察桌面，进入 `awaiting-world-save`。电脑动作失败会结算为错误，不进入 Agent 审核。默认路径不编辑 Word；录制中的文档编辑仍可在单测中用 Mock 验证，真实 Word 编辑不属于默认验收路径。

观察窗按 `plugins/frontend/workflow-observer/observer.watch.json` 的 `fields` 与 `infos` 两组规则显示指定的 Projection 字段和因果事件。字段使用 `nodeId` 加点分路径；Info 使用静态 `type` 过滤。观察窗只读，不负责确认或向图发送 Info。

`TriggerSmokeTest` 从 `smoke/entry` 进入单向图。未跳过文档编辑时，浏览器结果使 `smoke/doc-edit-gate` 公开 `edit-doc` 断点；`node agent-control.mjs wait|confirm` 只处理这个断点。默认路径在浏览器检查后执行电脑动作并观察桌面，由 `smoke/world-review` 公开 `save-world` 断点。`smoke/session` 只汇入阶段结果，不向上游发送 Info，整套装配的静态拓扑无环。

宿主把浏览器结果、电脑执行结果和观察事实送入 `agent/session`；Python `create_agent` 通过图内 `ask_world_save` 工具显示原生 Windows 决策框，观察真实选择后才可调用 `signal_world_save`。信号工具复核当前 `requestId` 与断点，将 `WorldSaveDecisionInfo` 注入 `smoke/world-review`。批准后 `smoke/world-document` EffectAdapter 把事实写入本 run 的 `.generated/data/worlds/`；拒绝则结束而不写文件。取消时保持等待。若 Agent 失败，`AgentReviewFailedInfo` 经 review 节点回传会话并结束等待。

弹窗请求和结果放在本 run 的 `.generated/data/world-save-dialogs/`。浏览器检查由 `host.mjs` 注入核心 `browser/executor`。执行器通过 `playwright-core` 的 `chromium.connectOverCDP()` 接入专用 Chrome，在独立页面上运行宿主注册的原生 Playwright 任务函数；任务可直接使用 `Page`、`Locator`、响应等待与事件监听。`check-home` 任务使用 `page.goto()` 返回的 HTTP 状态判定结果；4xx/5xx 或挑战页会使会话进入 `error`，不会触发保存确认。

本 run 还挂载核心 `example.ufo-computer-control` 插件为 `computer` 图，`example.browser-executor` 为 `browser` 图，`example.agent-executor` 为 `agent` 图，`example.agent-monitor` 为 `monitor` 图。宿主复用核心 `createUfoComputerBridge` 注入 `ufo/computer-execution` 与 `ufo/computer-observation`；默认 smoke 流程的电脑聚焦动作及桌面观察使用同一 UFO Bridge。通过 `.agents/skills/ufo-computer-control/scripts/ufo-computer.mjs <command> --run runs/desktop-smoke-test/run.config.json` 可单独验证核心电脑图的执行与观察。观察面板配置显示这几条链路的 Projection 与 Info；默认流程不执行 Word 编辑。
