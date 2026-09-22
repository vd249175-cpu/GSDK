---
name: gv-browser
description: >-
  GVSDK 专用浏览器接入与 Playwright 原生录制。
  专用浏览器（9343 端口、复用 .pi Profile 1 会话）拉起/复用，
  playwright-cli 按 channel 或 CDP 直连日常/专用浏览器，
  recording-start/stop 做 Playwright 原生动作录制。
  浏览器相关任务（导航、快照、录制、调试）优先读本技能。
---

# GVSDK 浏览器接入与录制

## 1. 专用浏览器（第一选择，免手点）

GVSDK 有自己的专用 Chrome，与日常 Chrome 物理隔离：

- 启动器：`GVSDK/.agents/skills/browser-setup/scripts/browser.ps1`
- 数据目录：`GVSDK/.agents/browser/data-Profile-1`（junction → `~/.pi/agent/browser/data-Profile-1`，复用 Profile 1/Van Minh 会话）
- 端口：**9343**（自动化发货用 9333，互不冲突）
- MCP 配置：`GVSDK/.omp/mcp.json` 的 `chrome-devtools` 条目经启动器 `-Action Mcp` 直连 `http://127.0.0.1:9343`

```powershell
# 拉起或复用（浏览器关了也能自己拉起来，无需用户动手）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\kp157\Desktop\PM\GVSDK\.agents\skills\browser-setup\scripts\browser.ps1" -Action Start
# 期望：{"selected":"Van Minh","port":9343,"browser":"Chrome/..."}
# 先探活：curl http://127.0.0.1:9343/json/version -> 200 即存活
```

9333 无响应 = 自动化发货的浏览器没开，与本技能无关，不要去动。

## 2. 连浏览器（playwright-cli，三选一）

全局已装 `@playwright/cli`（`playwright-cli --version` → 0.1.21+）。

```bash
cd C:/Users/kp157/Desktop/PM/GVSDK
# A. 连专用浏览器（CDP 直连，最稳）
playwright-cli attach --cdp=http://127.0.0.1:9343 --session <name>
# B. 连日常 Chrome（按 channel 名，不开新浏览器，不碰标签页）
playwright-cli attach --cdp=chrome
# C. 自己起无头浏览器（无状态验证用）
playwright-cli open https://example.com
```

会话内命令一律加 `-s=<name>` 前缀；结束用 `playwright-cli -s=<name> detach`（浏览器保持运行）或 `close`。

```bash
playwright-cli -s=<name> goto https://example.com
playwright-cli -s=<name> snapshot        # 取 ref（e.g. f1e6）
playwright-cli -s=<name> click f1e6
playwright-cli -s=<name> tab-list
```

9222/9333 的 `/json/version` 返回 404/000 均属正常历史现象（9222 是无调试标记的 chrome 主进程监听，9333 是别人的），不要据此改代码；channel attach 不需要端口。

## 3. 录制（Playwright 原生方案，唯一方案）

录制走 `playwright-cli` 的原生 `recording-start/stop`（底层输出 Playwright locator 代码），**不**用自动化发货的页内 JS 埋点（`recorder_script.py` 那套是为发货业务适配的：中文文本标签、输入事务合并、上传/scroll 去重——全局录制不需要这些业务适配）。

```bash
playwright-cli attach --cdp=http://127.0.0.1:9343 --session rec
playwright-cli -s=rec recording-start
playwright-cli -s=rec goto https://example.com
playwright-cli -s=rec snapshot            # 读 ref
playwright-cli -s=rec click f1e6          # 按 ref 操作
playwright-cli -s=rec recording-stop      # 输出录制的 Playwright 代码
playwright-cli -s=rec detach
```

2026-09-20 实测输出形状：

```js
await page.goto('https://example.com/');
await page.getByRole('link', { name: 'Learn more' }).click();
```

- `recording-start` 后所有 `goto/click/fill/...` 都被记录；`recording-stop` 一次性返回全部动作代码。
- 录制产物（`.playwright-cli/`、`.playwright-mcp/`）已进 `.gitignore`，不提交。
- GVSDK 的 `example.browser-recorder` 插件只定义会话因果拓扑（session/执行/观察三 Node），真实录制动作由宿主侧调本技能的 CLI 完成，不进 Node。

## 4. 排障

| 现象 | 处置 |
| :--- | :--- |
| `9343:000` | 专用浏览器没开，跑 §1 的 Start 命令自己拉 |
| `Port 9343 belongs to a different Chrome profile` | 有别的资料占了 9343，关掉那个 agent 窗口后重试，不关日常 Chrome |
| `/mcp list` 显示 `No MCP servers configured` | 会话 cwd 不在 GVSDK（空目录无 `.omp/mcp.json`），切到 GVSDK 会话 |
| `reconnect "playwright"` 失败 | 旧名已删，现有名 `chrome-devtools`，对旧名重连必然失败 |
| `chrome://inspect#remote-debugging` 手点 | 不用。专用浏览器走 `--remote-debugging-port` 启动器，无需 `--autoConnect` 手点流程 |
