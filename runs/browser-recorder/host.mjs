/**
 * runs/browser-recorder/host.mjs — run 宿主：向浏览器录制图注入 CDP 原生流式录制 Adapter。
 *
 * 架构位置：可选外层宿主（红线：Git/进程启动不进 Rust 内核；浏览器本体不进 Node）。
 * 浏览器会话由专用 Chrome (9343 端口) 托管，
 * 宿主通过 CDP WebSocket 直连专用浏览器，实时捕获用户动作并流式投递给观察节点。
 */

import { createCdpRecorder } from '../../app/plugins/backend/browser-recorder/index.mjs'

export async function createRunHost({ parsed } = {}) {
  const cdpUrl = parsed?.backend?.dependencies?.cdpUrl ?? 'http://127.0.0.1:9343'
  const { captureControl, captureEvents } = createCdpRecorder({ cdpUrl })
  return {
    dependenciesFor: {
      captureControl,
      captureEvents,
    },
  }
}

