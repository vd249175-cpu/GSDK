// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { RendererErrorBoundary } from './rendererErrorBoundary'

describe('recorder renderer error boundary', () => {
  it('keeps a visible recovery action after a panel render error', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    let broken = true
    const Content = () => {
      if (broken) throw new Error('字幕面板渲染异常')
      return <span>界面已恢复</span>
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<RendererErrorBoundary><Content /></RendererErrorBoundary>))
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('字幕面板渲染异常')
      broken = false
      await act(async () => {
        host.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(host.textContent).toContain('界面已恢复')
      expect(log).toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      log.mockRestore()
    }
  })
})
