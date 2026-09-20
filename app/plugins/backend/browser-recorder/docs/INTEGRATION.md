---
type: guide
title: Browser Recorder 集成说明
---

# Browser Recorder 集成说明（playwright-cli 原生录制）

本插件 ID 为 `example.browser-recorder`。它不 spawn 子进程、不持有浏览器、
不在 Node 内做任何 I/O；浏览器会话归用户所有（见 `.agents/skills/gv-browser/SKILL.md`：
`playwright-cli attach --cdp` 接专用 9343 或日常 Chrome），run 宿主
`runs/browser-recorder/host.mjs` 只在 change 结算时短暂 spawn
`playwright-cli -s=<session>` 发 recording-start/stop/snapshot。

## 1. 录制方案（唯一方案）

- 走 `playwright-cli` 原生 `recording-start/stop`，产物为 Playwright locator 代码
  （实测：`await page.goto(...)` / `getByRole(...).click()`）；`recording-stop`
  一次性返回全部动作代码，由 execution 经 `RecordingStatusInfo.actions`
  回填 session 的 `lastActions`。
- **不**用自动化发货的页内 JS 埋点（`recorder_script.py` 那套是为发货业务适配的，
  全局录制不需要），相关文件已删除。
- 本包**不新增** `playwright`/`playwright-core` 依赖；`playwright-cli` 是宿主侧
  外部二进制（全局安装），只活在 `runs/browser-recorder/host.mjs`，不进本包
  `package.json`，不进 Rust 内核。

## 2. 集成形状：宿主注入 runCli 的 EffectAdapter

- 不选插件直连：纯领域 Node 零 I/O，WorldNode 只调构造注入的 Adapter。
- run `backend.host`（`runs/browser-recorder/host.mjs` 的 `createRunHost`）注入：
  - `browser/capture-control`：`{ op: 'start', sessionId } → { handle }`；
    `{ op: 'stop', sessionId } → { stopped: true, actions }`（actions 为录制代码文本）；
  - `browser/capture-events`：`{ op: 'poll', sessionId, cursor } → { events: [{ kind: 'snapshot', snapshot }], cursor }`
    （录制中快照轮询，只做进度可见）。
- 组装函数：`createBrowserCaptureControlAdapter({ runCli, session })` 与
  `createBrowserCaptureEventsAdapter({ runCli, session })`；`runCli(args)` 由宿主以
  `execFile('playwright-cli', args)` 形式传入，本包不 import 任何浏览器 SDK，
  缺 `runCli` 构造即抛错。
- 会话名来源：`backend.dependencies.cliSession`，缺省 `'rec'`；浏览器会话本身由用户
  按 gv-browser 技能预先 `attach`，宿主不创建、不关闭会话。

## 3. 浏览器接入（见 gv-browser 技能）

- 专用浏览器：`.agents/skills/browser-setup/scripts/browser.ps1 -Action Start`
  拉起或复用 9343（复用 `.pi` Profile 1/Van Minh 会话），先 `curl
  http://127.0.0.1:9343/json/version` 探活（200 即存活）。
- 会话接入：`playwright-cli attach --cdp=http://127.0.0.1:9343 --session <name>`
  （或 `--cdp=chrome` 接日常 Chrome/裸 `open` 起无头浏览器）；命令一律
  `playwright-cli -s=<name> ...`，结束 `detach`（浏览器保持运行）。
- 9222/9333 的 `/json/version` 404/无响应是已知历史现象（9222 无调试标记的主进程
  监听、9333 属他人），channel attach 不需要端口，不要据此改代码。


## 4. 因果拓扑

```text
renderer → StartRecordingInfo/StopRecordingInfo → example.browser-recorder/session（Owner，唯一写 State）
session → StartCaptureInfo/StopCaptureInfo → example.browser-recorder/execution（ExecutionWorldNode，经 browser/capture-control 下发）
execution → RecordingStatusInfo(status/handle/actions) → session（句柄与录制代码回填 lastActions）
宿主/轮询 → PollRecordingEventsInfo → example.browser-recorder/observation（ObservationWorldNode，经 browser/capture-events 快照轮询）
observation → RecordingEventInfo → session（事件计数/lastEvent 回填）
```

State 写入只发生在各 Node 自己的 change 中；Node 间只用 `ctx.send(info, targetNodeId)`。

## 5. 装配与验证

个人 run 见 `runs/browser-recorder/`（本包附带的可运行装配示例，不碰
`runs/demo|alice|task-42|os-recorder`）：

```bash
node packages/tooling/run/src/cli.mjs validate runs/browser-recorder/run.config.json
npm --prefix packages/desktop test -- app/plugins/backend/browser-recorder/tests/backend.test.mjs app/plugins/backend/browser-recorder/tests/adapters.test.mjs --silent
```

真实浏览器只在显式 manual check 中出现（见 `tests/manual.cdp-probe.mjs`
：只读 `/json/version` 探活 + 一次原生录制 start/stop），永不进入自动化测试。
