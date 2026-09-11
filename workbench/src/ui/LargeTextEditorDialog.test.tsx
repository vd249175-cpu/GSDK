import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { LargeTextEditorDialog } from './LargeTextEditorDialog'

describe('LargeTextEditorDialog', () => {
  it('renders through a body portal and submits the edited value', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onSave = vi.fn()

    function Harness() {
      const [value, setValue] = useState('初始文本')
      return (
        <LargeTextEditorDialog
          title="编辑文本"
          value={value}
          onChange={setValue}
          onClose={vi.fn()}
          onSave={() => onSave(value)}
        />
      )
    }

    await act(async () => root.render(<Harness />))
    const dialog = document.body.querySelector('[role="dialog"]')
    const textarea = dialog?.querySelector('textarea') as HTMLTextAreaElement
    expect(dialog).not.toBeNull()
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, '修改后的文本')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      dialog?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(onSave).toHaveBeenCalledWith('修改后的文本')
    await act(async () => root.unmount())
    container.remove()
  })

  it('closes with Escape', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onClose = vi.fn()

    await act(async () => root.render(
      <LargeTextEditorDialog
        title="编辑文本"
        value="内容"
        onChange={vi.fn()}
        onClose={onClose}
        onSave={vi.fn()}
      />,
    ))
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))

    expect(onClose).toHaveBeenCalledOnce()
    await act(async () => root.unmount())
    container.remove()
  })
})
