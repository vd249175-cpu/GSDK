---
type: guide
title: OS Recorder 集成说明
---

# OS Recorder 集成说明（UFO 侧车）

本插件 ID 为 `example.os-recorder`。它不 vendoring、不 npm 依赖、不子进程拉起
Microsoft UFO；UFO 永远运行在 run 宿主提供的进程外侧车中，本插件只定义
DTO 契约与因果拓扑。

## 1. UFO 上游事实（2026-09-20 shallow clone，HEAD be75a7d）

- 仓库：`https://github.com/microsoft/UFO.git`（`git@` SSH 在本机不可达，走 HTTPS 只读 clone 到临时目录，不进仓库）。
- 许可：MIT（Microsoft Corporation，见上游 `LICENSE` 全文引用）。
- 语言：Python（约 495 个 `.py` 文件），入口 `python -m ufo -t <task> [-m normal|follower|batch_normal|operator]`（`ufo/ufo.py::main` 经 `SessionFactory` 建会话、`SessionPool.run_all` 运行）。
- 计算机操作面：`ufo/automator/ui_control/controller.py`（`ControlReceiver` + `UIControlReceiverFactory`；`ClickInputCommand` / `ClickOnCoordinatesCommand` / `DragOnCoordinatesCommand` / `SetEditTextCommand` / `GetTextsCommand`），底层 `pywinauto` + `uiautomation` + `pyautogui`，仅 Windows（`requirements.txt` 中 win32-gated）。
- 浏览器操作面：`ufo/automator/app_apis/web/webclient.py`（`WebReceiver`，`requests` + `html2text` 抓取转 markdown；重型页面抓取走可选 `crawl4ai`，见上游注释）。
- 智能体面：`ufo/agents/agent/host_agent.py::HostAgent`（任务编排）+ `app_agent.py::AppAgent`（应用执行）/ `OpenAIOperatorAgent`；会话工厂 `ufo/module/session_pool.py::SessionFactory`。
- 运行时依赖（`requirements.txt`，47 行）：`openai`、`langchain*`、`sentence-transformers`、`faiss-cpu`、`pywin32`、`pywinauto`、`pyautogui`、`uiautomation`、`flask`、`fastapi`、`uvicorn`、`azure-*` 等重型 ML/云依赖。

## 2. 集成形状：外部进程经 EffectAdapter（唯一选项）

- 不选 npm/git 依赖：UFO 是 Python Windows 应用，无 JS 入口，放进 Node 会拖入整条 ML 依赖链，且违反“物理下沉到 Adapter 管理的执行环境”。
- 不选 vendored adapter：复制上游源码即承担其发布物所有权，与 `publisher-replace-only` 边界冲突；上游演进只能整体跟进。
- 采用形状：UFO 侧车进程（团队另行按上游文档部署）+ run `backend.host` 注入两个 EffectAdapter：
  - `ufo/capture-control`：`{ op: 'start'|'stop', sessionId } → { handle }`（执行面）；
  - `ufo/capture-events`：`{ op: 'poll', sessionId, cursor } → { events: [...], cursor }`（观察面）。
- 插件出厂只带缺省抛错桩（未注入时明确报错），测试用 fake Adapter；Rust 内核、daemon、Node 侧永远不直连 UFO、无真实 OS hook。

## 3. 因果拓扑

```text
renderer → StartRecordingInfo/StopRecordingInfo → example.os-recorder/session（Owner，唯一写 State）
session → StartCaptureInfo/StopCaptureInfo → example.os-recorder/execution（ExecutionWorldNode，经 ufo/capture-control 下发）
execution → RecordingStatusInfo → session（提交句柄回填）
宿主/轮询 → PollRecordingEventsInfo → example.os-recorder/observation（ObservationWorldNode，经 ufo/capture-events 轮询）
observation → RecordingEventInfo → session（事件计数/lastEvent 回填）
```

State 写入只发生在各 Node 自己的 change 中；Node 间只用 `ctx.send(info, targetNodeId)`。

## 4. 装配与验证

个人 run 见 `runs/os-recorder/`（本包附带的可运行装配示例，不碰 `runs/demo|alice|task-42`）：

```bash
node packages/tooling/run/src/cli.mjs validate runs/os-recorder/run.config.json
npm --prefix packages/desktop test -- app/plugins/backend/os-recorder/tests/backend.test.mjs --silent
```
