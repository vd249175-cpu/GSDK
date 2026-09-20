/**
 * runs/browser-recorder/host.mjs — run 宿主：向浏览器录制图注入 playwright-cli 录制 Adapter。
 *
 * 架构位置：可选外层宿主（红线：Git/进程启动不进 Rust 内核；浏览器本体不进 Node）。
 * 浏览器会话生命周期归用户（见 .agents/skills/gv-browser/SKILL.md：attach --cdp），
 * 本宿主只在 change 结算时短暂 spawn `playwright-cli -s=<session>` 发 recording-start/
 * recording-stop/snapshot，不持有长连接，无 stopSources/dispose。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  createBrowserCaptureControlAdapter,
  createBrowserCaptureEventsAdapter,
} from '../../app/plugins/backend/browser-recorder/index.mjs'

const execFileAsync = promisify(execFile)

const runCli = async (args) => {
  try {
    const { stdout } = await execFileAsync('playwright-cli', args, { timeout: 120000 })
    return stdout
  } catch (error) {
    throw new Error(`playwright-cli ${args.join(' ')} 失败：${error.message ?? error}`, { cause: error })
  }
}

export async function createRunHost({ parsed } = {}) {
  const session = parsed?.backend?.dependencies?.cliSession ?? 'rec'
  return {
    dependenciesFor: {
      captureControl: createBrowserCaptureControlAdapter({ runCli, session }),
      captureEvents: createBrowserCaptureEventsAdapter({ runCli, session }),
    },
  }
}
