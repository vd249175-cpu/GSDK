import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { InlineSelect } from './InlineSelect'

describe('InlineSelect', () => {
  it('renders its menu in the trigger owner document', async () => {
    const floatingDocument = document.implementation.createHTMLDocument('floating')
    const container = floatingDocument.createElement('div')
    floatingDocument.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <InlineSelect
          ariaLabel="面板"
          onChange={vi.fn()}
          options={[{ value: 'agent', label: 'Agent 终端' }]}
          value="agent"
        />,
      )
    })
    await act(async () => {
      container.querySelector('button')?.click()
    })

    expect(floatingDocument.body.querySelector('[role="listbox"]')).not.toBeNull()
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
    await act(async () => root.unmount())
  })
})
