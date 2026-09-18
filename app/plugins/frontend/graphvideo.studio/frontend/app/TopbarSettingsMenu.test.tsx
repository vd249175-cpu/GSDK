import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { TopbarSettingsMenu } from './TopbarSettingsMenu'

describe('TopbarSettingsMenu', () => {
  it('keeps low-frequency actions behind one settings trigger', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onUndo = vi.fn()

    await act(async () => {
      root.render(
        <TopbarSettingsMenu
          canRedo={false}
          canSaveLayout
          canUndo
          isMac={false}
          layoutSaved={false}
          refreshing={false}
          theme="dark"
          typography={{ font: 'default', size: 'standard' }}
          undoLabel="移动节点"
          onRedo={vi.fn()}
          onRefreshComponents={vi.fn()}
          onReloadApplication={vi.fn()}
          onSaveDefaultLayout={vi.fn()}
          onThemeChange={vi.fn()}
          onTypographyChange={vi.fn()}
          onUndo={onUndo}
        />,
      )
    })

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toBe('设置')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="打开应用设置"]')?.click()
    })

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.textContent).toContain('历史与布局')
    expect(dialog?.textContent).toContain('外观')
    expect(dialog?.textContent).toContain('维护')

    const undoButton = Array.from(dialog?.querySelectorAll('button') ?? [])
      .find((button) => button.textContent === '撤回')
    await act(async () => undoButton?.click())

    expect(onUndo).toHaveBeenCalledOnce()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => root.unmount())
    container.remove()
  })
})
