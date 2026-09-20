/**
 * 手动验证（manual check，永不进入自动化测试）：
 * 对专用浏览器（默认 http://127.0.0.1:9343）做只读 GET /json/version，
 * 再用 playwright-cli 做一次原生录制 start/stop（example.com 跳转 + 快照），
 * 确认 recording-stop 能返回 Playwright 动作代码。用法：
 *   node app/plugins/backend/browser-recorder/tests/manual.cdp-probe.mjs [cdp-endpoint]
 * 录制会话名固定 `manual-probe`，跑完即 detach，不碰用户可见标签页之外的状态。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const endpoint = process.argv[2] ?? process.env.GVSDK_BROWSER_CDP_ENDPOINT ?? 'http://127.0.0.1:9343'
const session = 'manual-probe'
const cli = async (...args) => (await execFileAsync('playwright-cli', args, { timeout: 60000 })).stdout

const versionResponse = await fetch(new URL('/json/version', endpoint).href)
console.log(`MANUAL-ONLY: GET /json/version -> ${versionResponse.status}`)
if (!versionResponse.ok) {
  console.error('MANUAL-ONLY: endpoint 不提供 CDP /json/version 面，停止（不视作失败）')
  process.exit(2)
}
await cli('attach', `--cdp=${endpoint}`, '--session', session)
try {
  await cli(`-s=${session}`, 'recording-start')
  await cli(`-s=${session}`, 'goto', 'https://example.com')
  const stopOutput = await cli(`-s=${session}`, 'recording-stop')
  if (!stopOutput.includes('page.goto')) throw new Error('recording-stop 未返回 Playwright 动作代码')
  console.log('MANUAL-ONLY: recording-stop 返回动作代码 OK')
} finally {
  await cli(`-s=${session}`, 'detach')
}
