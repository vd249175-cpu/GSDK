import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createBrowserExecutor } from '../../../app/plugins/backend/browser-executor/bridge/browser-executor.mjs'
import { checkHome } from '../host.mjs'

function fakeBrowser() {
  const calls = []
  const page = new EventEmitter()
  page.goto = async (url) => {
    calls.push(['goto', url])
    page.emit('response', { url: () => `${url}?session=secret`, status: () => 200, request: () => ({ resourceType: () => 'document' }) })
    page.emit('response', { url: () => `${url}style.css`, status: () => 200, request: () => ({ resourceType: () => 'stylesheet' }) })
    return { status: () => 200 }
  }
  page.url = () => 'https://example.com/'
  page.title = async () => 'Example Domain'
  page.getByRole = (role, options) => ({
    click: async () => calls.push(['click', role, options]),
  })
  page.waitForResponse = async (predicate) => {
    const response = { url: () => 'https://example.com/api/search', status: () => 200 }
    if (!predicate(response)) throw new Error('unmatched response')
    return response
  }
  page.close = async () => calls.push(['page.close'])
  const context = { newPage: async () => page }
  const browser = { contexts: () => [context], close: async () => calls.push(['browser.close']) }
  const chromium = { connectOverCDP: async (url) => { calls.push(['connect', url]); return browser } }
  return { calls, page, chromium }
}

describe('Playwright SDK browser executor', () => {
  it('runs a complex native Page task and captures operation events', async () => {
    const { calls, page, chromium } = fakeBrowser()
    const executor = createBrowserExecutor({
      chromium,
      ensureBrowser: async () => calls.push(['ensure']),
      tasks: {
        search: async ({ page: taskPage }, input) => {
          await taskPage.goto(input.url)
          await taskPage.getByRole('button', { name: 'Search' }).click()
          const response = await taskPage.waitForResponse((r) => r.url().includes('/api/search') && r.status() === 200)
          page.emit('console', { type: () => 'error', text: () => 'search failed' })
          return { status: response.status() }
        },
      },
    })
    const result = await executor.execute({ task: 'search', url: 'https://example.com/' })
    expect(result.status).toBe(200)
    expect(result.events).toEqual([
      { kind: 'response', url: 'https://example.com/', status: 200 },
      { kind: 'console', level: 'error' },
    ])
    expect(calls.slice(0, 3)).toEqual([['ensure'], ['connect', 'http://127.0.0.1:9343'], ['goto', 'https://example.com/']])
    await executor.dispose()
    expect(calls.slice(-2)).toEqual([['page.close'], ['browser.close']])
  })

  it('rejects unknown tasks before opening a browser', async () => {
    const { calls, chromium } = fakeBrowser()
    const executor = createBrowserExecutor({ chromium, tasks: {} })
    await expect(executor.execute({ task: 'arbitrary-js' })).rejects.toThrow('Unknown browser task')
    expect(calls).toEqual([])
  })

  it('does not treat an HTTP 403 challenge as a ready page', async () => {
    const page = { goto: async () => ({ status: () => 403 }) }
    await expect(checkHome({ page }, { url: 'https://www.npmjs.com/' })).rejects.toThrow('HTTP 403')
  })
})
