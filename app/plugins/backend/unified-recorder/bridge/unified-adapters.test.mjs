import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createUnifiedAdapters,
  parsePlaywrightScript,
  parsePsrMhtAndExtractScreenshots,
  readPsrArchiveAndExtract,
  mergeAndCleanEvents,
  buildAgentTranscript,
  buildReplayScript,
  processRecordingExport,
} from './unified-adapters.mjs'

const fakeCli = (outputs, seen = []) => async (args) => {
  seen.push(args)
  const out = outputs.shift()
  if (out instanceof Error) throw out
  return out ?? ''
}

const SAMPLE_MHT = `From: <Saved by Windows Steps Recorder>
Subject: Problem Steps
Date: Mon, 21 Sep 2026 15:00:00 +0800
MIME-Version: 1.0
Content-Type: multipart/related; boundary="----=_NextPart_GVSDK_TEST"

------=_NextPart_GVSDK_TEST
Content-Type: text/html
Content-Location: main.htm

<HTML><BODY></BODY></HTML>

------=_NextPart_GVSDK_TEST
Content-Type: text/xml
Content-Location: userAction.xml

<UserActionData>
  <RecordSession StartTime="15:00:00" StopTime="15:05:00" ActionCount="2" MissedActionCount="0" />
  <EachAction ActionNumber="1" Time="15:00:05" FileName="CHROME.EXE" FileDescription="Google Chrome">
    <Action>User left click on "Learn more" in "Google Chrome"</Action>
    <Description>Left click at (200, 300) in Chrome</Description>
    <ScreenshotFileName>screenshot0001.jpeg</ScreenshotFileName>
  </EachAction>
  <EachAction ActionNumber="2" Time="15:00:20" FileName="NOTEPAD.EXE" FileDescription="Notepad">
    <Action>User left click on "Edit"</Action>
    <Description>Left click on Notepad edit box</Description>
    <ScreenshotFileName>screenshot0002.jpeg</ScreenshotFileName>
  </EachAction>
</UserActionData>

------=_NextPart_GVSDK_TEST
Content-Type: image/jpeg
Content-Location: screenshot0001.jpeg
Content-Transfer-Encoding: base64

/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=

------=_NextPart_GVSDK_TEST
Content-Type: image/jpeg
Content-Location: screenshot0002.jpeg
Content-Transfer-Encoding: base64

/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=

------=_NextPart_GVSDK_TEST--
`

describe('unified-adapters', () => {
  it('从 MHT 解出 Base64 截图落盘并解析出 XML 动作及相对路径', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'unified-test-mht-'))
    try {
      const screenshotsDir = join(tempDir, 'screenshots')
      const result = await parsePsrMhtAndExtractScreenshots(SAMPLE_MHT, screenshotsDir)

      expect(result.events).toHaveLength(2)
      expect(result.events[0].application).toBe('CHROME.EXE')
      expect(result.events[0].screenshotFile).toBe('screenshots/screenshot0001.jpeg')
      expect(result.events[1].application).toBe('NOTEPAD.EXE')
      expect(result.events[1].screenshotFile).toBe('screenshots/screenshot0002.jpeg')

      // 验证截图确实写到了磁盘上且内容非空
      const shot1 = await stat(join(screenshotsDir, 'screenshot0001.jpeg'))
      expect(shot1.isFile()).toBe(true)
      expect(shot1.size).toBeGreaterThan(0)
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('从 Microsoft UFO 演示样本 ZIP (sample_record.zip) 提取全部 JPEG 截图真实落盘并关联事件', async () => {
    const sampleZip = resolve('packages/ufo/record_processor/example/sample_record.zip')
    const tempDir = await mkdtemp(join(tmpdir(), 'unified-test-ufo-zip-'))
    try {
      const screenshotsDir = join(tempDir, 'screenshots')
      const result = await readPsrArchiveAndExtract(sampleZip, screenshotsDir)

      expect(result.events).toHaveLength(7)
      expect(result.applications).toContain('MSEDGEWEBVIEW2.EXE')
      expect(result.screenshots.length).toBeGreaterThanOrEqual(5)

      // 验证每个包含截图的事件其 screenshotFile 路径有效
      for (const event of result.events) {
        if (event.screenshotFile) {
          expect(event.screenshotFile).toMatch(/^screenshots\/screenshot\d+\.jpeg$/i)
          const fileOnDisk = join(tempDir, event.screenshotFile)
          const info = await stat(fileOnDisk)
          expect(info.isFile()).toBe(true)
          expect(info.size).toBeGreaterThan(0)
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('解析 Playwright 脚本行并提取输入明文', () => {
    const script = [
      "await page.goto('https://example.com/login');",
      "await page.getByRole('button', { name: 'Submit' }).click();",
      "await page.getByLabel('Username').fill('test_admin');",
    ].join('\n')

    const events = parsePlaywrightScript(script)
    expect(events).toHaveLength(3)
    expect(events[0].action).toBe('goto')
    expect(events[0].application).toBe('example.com')
    expect(events[1].action).toBe('click')
    expect(events[2].action).toBe('fill')
    expect(events[2].text).toBe('test_admin')
  })

  it('正确从 playwright-cli 返回的 Markdown 中提取真实代码段与操作', () => {
    const cliOutput = `### Result
Recording stopped. Recorded actions:

\`\`\`js
await page.goto('https://example.com/');
await page.getByRole('button', { name: 'Login' }).click();
\`\`\`
### Page
- Page URL: https://example.com/
- Page Title: Example Domain`

    const events = parsePlaywrightScript(cliOutput)
    expect(events).toHaveLength(2)
    expect(events[0].action).toBe('goto')
    expect(events[0].code).toBe("await page.goto('https://example.com/');")
    expect(events[1].action).toBe('click')
  })

  it('合并桌面动作与浏览器动作：桌面截图赋给浏览器对应动作，桌面外部动作保留', () => {
    const desktopEvents = [
      {
        index: 1,
        time: '15:00:05',
        source: 'desktop',
        application: 'CHROME.EXE',
        action: 'User left click in Chrome',
        description: 'Click on button',
        screenshotFile: 'screenshots/screenshot0001.jpeg',
      },
      {
        index: 2,
        time: '15:00:15',
        source: 'desktop',
        application: 'NOTEPAD.EXE',
        action: 'User left click in Notepad',
        description: 'Click in notepad',
        screenshotFile: 'screenshots/screenshot0002.jpeg',
      },
    ]

    const browserEvents = [
      {
        index: 1,
        source: 'browser',
        application: 'example.com',
        action: 'click',
        description: 'Browser click',
        code: "await page.getByRole('button').click();",
        text: null,
        screenshotFile: null,
      },
    ]

    const merged = mergeAndCleanEvents({ desktopEvents, browserEvents })
    expect(merged).toHaveLength(2)
    // 第一个对应 Chrome 内动作，由浏览器精准动作接管，并继承桌面截图
    expect(merged[0].source).toBe('browser')
    expect(merged[0].code).toContain('page.getByRole')
    expect(merged[0].screenshotFile).toBe('screenshots/screenshot0001.jpeg')
    // 第二个是非浏览器的桌面动作（Notepad）
    expect(merged[1].source).toBe('desktop')
    expect(merged[1].application).toBe('NOTEPAD.EXE')
    expect(merged[1].screenshotFile).toBe('screenshots/screenshot0002.jpeg')
  })

  it('生成专供 Agent 的纯文字 Markdown 版本，包含相对截图路径，绝不内嵌 Base64', () => {
    const transcript = buildAgentTranscript({
      sessionId: 'test-session',
      startedAt: '15:00:00',
      completedAt: '15:05:00',
      applications: ['CHROME.EXE', 'NOTEPAD.EXE'],
      events: [
        {
          index: 1,
          time: '15:00:05',
          source: 'browser',
          application: 'example.com',
          action: 'fill',
          description: 'Type credentials',
          windowTitle: 'https://example.com',
          code: "await page.fill('#user', 'alice');",
          text: 'alice',
          screenshotFile: 'screenshots/screenshot0001.jpeg',
        },
      ],
    })

    expect(transcript).toContain('# Unified Recording Transcript: test-session')
    expect(transcript).toContain('### Step 01 [Browser | example.com]')
    expect(transcript).toContain('- Action: fill')
    expect(transcript).toContain('- Input Text: "alice"')
    expect(transcript).toContain('- Screenshot: screenshots/screenshot0001.jpeg')
    // 关键红线：绝对不能包含 base64 字符串
    expect(transcript).not.toContain('base64')
    expect(transcript).not.toContain('data:image')
  })

  it('完整导出后处理流水线：保存原生产物、提取截图、生成 agent-transcript.md', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'unified-test-export-'))
    try {
      const browserCode = "await page.goto('https://example.com');\nawait page.click('button');"
      const result = await processRecordingExport({
        sessionId: 'session-full',
        sessionDirectory: tempDir,
        browserRawActions: browserCode,
        desktopZipPath: null,
        liveDesktopEvents: [
          {
            index: 1,
            time: '15:00:01',
            source: 'desktop',
            application: 'EXPLORER.EXE',
            action: 'Mouse Left Click',
            description: 'Clicked folder',
            screenshotFile: null,
          },
        ],
        readArchive: async () => ({ events: [], applications: [] }),
      })

      expect(result.events).toHaveLength(3)
      expect(result.nativeExports.browser).toBe(join(tempDir, 'native', 'browser-playwright.js'))

      // 验证文件存在
      const transcriptDisk = await readFile(result.agentTranscriptPath, 'utf8')
      expect(transcriptDisk).toContain('Unified Recording Transcript: session-full')

      const rawBrowserDisk = await readFile(result.nativeExports.browser, 'utf8')
      expect(rawBrowserDisk).toContain('page.goto')

      const jsonDisk = JSON.parse(await readFile(join(tempDir, 'unified-events.json'), 'utf8'))
      expect(jsonDisk.events).toHaveLength(3)
      expect(jsonDisk.agentTranscript).toBe('agent-transcript.md')
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('适配器控制面可正常与 playwright-cli 交互', async () => {
    const seen = []
    const adapters = createUnifiedAdapters({
      runCli: fakeCli(['', '', '- heading "Title"', "await page.goto('https://example.com');", ''], seen),
      cliSession: 'test-rec',
    })

    const started = await adapters.browserControl.execute({ op: 'start', sessionId: 's-1' })
    expect(started.handle).toBe('playwright-cli:test-rec:s-1')

    const polled = await adapters.browserEvents.execute({ op: 'poll', sessionId: 's-1' })
    expect(polled.events[0].snapshot).toContain('heading')

    const stopped = await adapters.browserControl.execute({ op: 'stop', sessionId: 's-1' })
    expect(stopped.actions).toContain('page.goto')
  })
})
