---
type: Reference Manual
title: 浏览器执行器插件
description: Playwright CDP 任务执行和独立浏览器观察节点的核心插件契约。
status: stable
---

# 浏览器执行器

`example.browser-executor` 位于 `app/plugins/backend/browser-executor/`。`RunBrowserTaskInfo` 进入 `session`，`execution` 通过注入的 `browser/executor` EffectAdapter 执行宿主注册的 Playwright 任务，`observation` 再单独读取当前页面 URL 与标题；最终事实保存在 `result` 节点。任务只接受宿主白名单中的名称；核心桥提供 `checkHomeTask` 示例，导航后检查 HTTP 状态与挑战页。

桥通过 `chromium.connectOverCDP()` 连接专用浏览器 9343 端口，并串行化共享 Page 的物理操作，避免多个任务争抢同一标签。`runs/desktop-smoke-test/` 和 `runs/main/` 都装配该核心插件；电脑控制继续使用 `example.ufo-computer-control` 的独立执行与观察节点。真实浏览器启停仍按 `gv-browser` 技能与根 `run.sh` 守卫操作。
