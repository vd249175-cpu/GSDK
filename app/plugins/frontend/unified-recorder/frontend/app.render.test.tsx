// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { App } from './app'

describe('unified recorder renderer', () => {
  it('mounts the controls workspace without a render error', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<App />))
      expect(host.textContent).toContain('录制控制核心')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('keeps the workbench visible when a failed snapshot omits optional lists', async () => {
    const shell = window as typeof window & { recorder?: unknown }
    shell.recorder = {
      readState: async () => ({
        status: 'error', sessionId: null, eventCount: 0, events: [], applications: [],
        subtitles: [], audioClips: [], lastError: 'Projection is unavailable', revision: 0,
      }),
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<App />))
      expect(host.textContent).toContain('录制控制核心')
      expect(host.textContent).toContain('Projection is unavailable')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      delete shell.recorder
    }
  })

  it('shows a state error when the bridge returns null', async () => {
    const shell = window as typeof window & { recorder?: unknown }
    shell.recorder = { readState: async () => null }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<App />))
      expect(host.textContent).toContain('录制控制核心')
      expect(host.textContent).toContain('录制状态数据无效')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      delete shell.recorder
    }
  })

  it('drops malformed nested projection entries before rendering panels', async () => {
    const shell = window as typeof window & { recorder?: unknown }
    shell.recorder = { readState: async () => ({
      status: 'idle', events: [null, { screenshotFile: 42 }],
      applications: [null], progressLog: [null], subtitles: [null], audioClips: [null],
    }) }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<App />))
      expect(host.textContent).toContain('录制控制核心')
      expect(host.textContent).toContain('暂无独立截图')
      expect(host.textContent).toContain('暂无字幕')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      delete shell.recorder
    }
  })

  it('shows bridge read errors and keeps polling recoverable', async () => {
    const shell = window as typeof window & { recorder?: unknown }
    shell.recorder = { readState: async () => { throw new Error('状态服务暂不可用') } }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<App />))
      expect(host.textContent).toContain('录制控制核心')
      expect(host.textContent).toContain('状态服务暂不可用')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      delete shell.recorder
    }
  })
})
