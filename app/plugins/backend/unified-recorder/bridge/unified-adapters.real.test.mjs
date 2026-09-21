import { access, mkdtemp, rm, stat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { createRunCli, createUnifiedAdapters } from './unified-adapters.mjs'

/**
 * 真机单元测试（real devices，失败即信号）：
 * - 浏览器：专用 Chrome 9343 + 真实 playwright-cli（attach → recording-start →
 *   goto → snapshot → recording-stop → detach），9343 不存活则跳过；
 * - 桌面：占位 Adapter 真实语义 + 真实 psr.exe/tar.exe 启停产出 ZIP/MHT，
 *   非 Windows 或二进制缺失则跳过。
 * 个人系统：浏览器 fill 明文原样透传，不做脱敏。
 */

const execFileAsync = promisify(execFile)
const CDP = 'http://127.0.0.1:9343'
const SESSION = 'unified-real'
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const runCli = createRunCli()

const browserAlive = async () => {
  try {
    const response = await fetch(`${CDP}/json/version`)
    return response.ok
  } catch {
    return false
  }
}

describe('unified-adapters real devices', () => {
  it('browser 真机 recording-start → goto → snapshot → recording-stop', async () => {
    if (!(await browserAlive())) {
      console.warn('专用浏览器 9343 未运行，跳过浏览器真机测试')
      return
    }
    await runCli(['attach', `--cdp=${CDP}`, '--session', SESSION])
    try {
      const adapters = createUnifiedAdapters({ runCli, cliSession: SESSION })
      const started = await adapters.browserControl.execute({ op: 'start', sessionId: 'real-1' })
      expect(started.handle).toBe(`playwright-cli:${SESSION}:real-1`)

      await runCli([`-s=${SESSION}`, 'goto', 'https://example.com'])
      const polled = await adapters.browserEvents.execute({ op: 'poll', sessionId: 'real-1', cursor: 'c-0' })
      expect(polled.cursor).toBe('c-0')
      expect(polled.events).toHaveLength(1)
      expect(typeof polled.events[0].snapshot).toBe('string')
      expect(polled.events[0].snapshot.length).toBeGreaterThan(0)

      const stopped = await adapters.browserControl.execute({ op: 'stop', sessionId: 'real-1' })
      expect(stopped.stopped).toBe(true)
      expect(stopped.actions).toContain('page.goto')
      expect(stopped.actions).toContain('https://example.com')
    } finally {
      await runCli([`-s=${SESSION}`, 'detach']).catch(() => {})
    }
  }, 90000)

  it('desktop 占位 start/stop 真实语义', async () => {
    const adapters = createUnifiedAdapters({ runCli: async () => '' })
    const started = await adapters.desktopControl.execute({ op: 'start', sessionId: 'real-desk' })
    expect(started.handle).toBe('unified-desktop:real-desk')
    await expect(adapters.desktopControl.execute({ op: 'start', sessionId: 'real-desk' }))
      .rejects.toThrow('already active')
    expect(await adapters.desktopEvents.execute({ op: 'poll', sessionId: 'real-desk' }))
      .toEqual({ events: [] })
    expect(await adapters.desktopControl.execute({ op: 'stop', sessionId: 'real-desk' }))
      .toMatchObject({ stopped: true })
    const observed = await adapters.desktopObservation.execute({ op: 'observe', sessionId: 'real-desk' })
    expect(observed.events).toEqual([])
    expect(typeof observed.completedAt).toBe('string')
  })

  it.skip('desktop 真机 PSR 启停产出 ZIP/MHT [Win11 24H2 psr deprecated，手动跑]', async () => {
    if (process.platform !== 'win32') {
      console.warn('非 Windows，跳过 PSR 真机测试')
      return
    }
    const windir = process.env.WINDIR ?? 'C:\\Windows'
    const psr = join(windir, 'System32', 'psr.exe')
    const tar = join(windir, 'System32', 'tar.exe')
    try {
      await access(psr, fsConstants.X_OK)
      await access(tar, fsConstants.X_OK)
    } catch {
      console.warn('PSR/tar 二进制不可用，跳过 PSR 真机测试')
      return
    }
    const directory = await mkdtemp(join(tmpdir(), 'unified-real-psr-'))
    try {
      const artifact = join(directory, 'probe.zip')
      const args = ['/start', '/output', artifact, '/sc', '1', '/gui', '0', '/arcxml', '1', '/maxsc', '100']
      await new Promise((resolve, reject) => {
        const child = spawn(psr, args, { stdio: 'ignore', windowsHide: true })
        child.once('error', (error) => {
          if (error?.code !== 'EACCES') {
            reject(error)
            return
          }
          execFileAsync(
            join(windir, 'System32', 'rundll32.exe'),
            ['shell32.dll,ShellExec_RunDLL', psr, ...args],
            { windowsHide: true, timeout: 30000 },
          ).then(resolve, reject)
        })
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
      await sleep(3000)
      await execFileAsync(psr, ['/stop'], { windowsHide: true, timeout: 30000 }).catch(() => {})
      const deadline = Date.now() + 15000
      for (;;) {
        try {
          const details = await stat(artifact)
          if (details.isFile() && details.size > 0) break
        } catch {
          // PSR 异步落盘中。
        }
        if (Date.now() > deadline) throw new Error(`PSR 未产出 ${artifact}`)
        await sleep(200)
      }
      const { stdout } = await execFileAsync(tar, ['-tf', artifact], { windowsHide: true, timeout: 30000 })
      expect(stdout.toLowerCase()).toContain('.mht')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 90000)
})
