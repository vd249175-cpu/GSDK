import { chromium as defaultChromium } from 'playwright-core'

const safeUrl = (value) => {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return '[invalid URL]'
  }
}

export async function checkHomeTask({ page }, { url }) {
  const target = new URL(url)
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Browser URL must use http or https')
  const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30000 })
  const status = response?.status()
  if (!status || status >= 400) throw new Error(`Browser navigation returned HTTP ${status ?? 'unknown'}`)
  const title = await page.title()
  if (/just a moment|请稍候/i.test(title)) throw new Error('Browser challenge page blocked navigation')
  return { opened: true, url: safeUrl(page.url()), httpStatus: status, title }
}

/** Host-side EffectAdapter. Tasks receive real Playwright Browser, Context and Page objects. */
export function createBrowserExecutor({
  chromium = defaultChromium,
  ensureBrowser = async () => {},
  cdpUrl = 'http://127.0.0.1:9343',
  tasks = {},
} = {}) {
  if (typeof chromium?.connectOverCDP !== 'function') throw new Error('A Playwright chromium BrowserType is required')
  if (typeof ensureBrowser !== 'function') throw new Error('ensureBrowser() must be a function')
  let browser = null
  let context = null
  let page = null
  let closed = false
  let tail = Promise.resolve()

  const serialize = (work) => {
    const result = tail.then(work)
    tail = result.catch(() => undefined)
    return result
  }
  const connect = async () => {
    if (browser?.isConnected?.() !== false && page) return
    await ensureBrowser()
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 15000 })
    context = browser.contexts()[0]
    if (!context) throw new Error('CDP browser has no default context')
    page = await context.newPage()
  }

  return {
    id: 'browser/executor',
    async execute(request) {
      if (closed) throw new Error('Browser executor is closed')
      const task = typeof request?.task === 'string' && Object.hasOwn(tasks, request.task) ? tasks[request.task] : null
      if (typeof task !== 'function') throw new Error(`Unknown browser task: ${String(request?.task)}`)
      return serialize(async () => {
        await connect()
        const events = []
        const record = (event) => { if (events.length < 50) events.push(event) }
        const onResponse = (response) => {
          const status = response.status()
          if (response.request?.()?.resourceType?.() === 'document' || status >= 400) {
            record({ kind: 'response', url: safeUrl(response.url()), status })
          }
        }
        const onConsole = (message) => {
          const level = message.type()
          if (level === 'warning' || level === 'error') record({ kind: 'console', level })
        }
        const onRequestFailed = (failed) => record({ kind: 'requestfailed', url: safeUrl(failed.url()) })
        page.on('response', onResponse)
        page.on('console', onConsole)
        page.on('requestfailed', onRequestFailed)
        try {
          const value = await task({ browser, context, page }, request)
          return { ...(value && typeof value === 'object' && !Array.isArray(value) ? value : { value }), events }
        } finally {
          page.off('response', onResponse)
          page.off('console', onConsole)
          page.off('requestfailed', onRequestFailed)
        }
      })
    },
    async observe() {
      if (closed) throw new Error('Browser executor is closed')
      return serialize(async () => {
        await connect()
        return { url: safeUrl(page.url()), title: await page.title() }
      })
    },
    async dispose() {
      if (closed) return
      closed = true
      await serialize(async () => {
        try { await page?.close() } catch { /* page may already be closed */ }
        try { await browser?.close() } catch { /* CDP may already be disconnected */ }
        page = null
        context = null
        browser = null
      })
    },
  }
}
