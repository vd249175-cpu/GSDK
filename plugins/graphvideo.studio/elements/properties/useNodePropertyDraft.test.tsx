import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectNode } from '@graphvideo/client-sdk'
import {
  useNodePropertyDraft, type NodePropertyPatch,
} from './useNodePropertyDraft'

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean
}

const firstNode: ProjectNode = {
  id: 'node-first',
  type: 'text',
  title: '第一节点',
  description: 'abcd',
  content: '正文',
}

const secondNode: ProjectNode = {
  id: 'node-second',
  type: 'image',
  title: '第二节点',
  description: '第二描述',
  prompt: '第二提示词',
  history: [],
}

function DraftHarness({
  node, persist, revision = 1,
}: {
  node: ProjectNode
  persist(nodeId: string, patch: NodePropertyPatch): Promise<{ revision: number }>
  revision?: number
}) {
  const draft = useNodePropertyDraft(node, persist, revision)
  return (
    <textarea
      aria-label="描述"
      value={draft.values.description}
      onChange={(event) => draft.update('description', event.target.value)}
      {...draft.fieldEvents}
    />
  )
}

function enterValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (!setter) throw new Error('textarea value setter unavailable')
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

function createPersist() {
  return vi.fn(async (...args: [string, NodePropertyPatch, string?]) => { void args; return { revision: 2 } })
}

describe('node property draft', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('updates the controlled value immediately and debounces persistence', async () => {
    const persist = createPersist()
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    await act(async () => enterValue(textarea, 'abXcd'))
    expect(textarea.value).toBe('abXcd')
    expect(persist).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(399))
    expect(persist).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(persist).toHaveBeenCalledWith('node-first', { description: 'abXcd' }, undefined)
  })

  it('keeps the caret and draft when an older storage snapshot returns during editing', async () => {
    const persist = createPersist()
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      textarea.focus()
      enterValue(textarea, 'abXcd')
    })
    textarea.setSelectionRange(3, 3)

    await act(async () => root.render(
      <DraftHarness node={{ ...firstNode, description: 'abcd' }} persist={persist} />,
    ))

    expect(textarea.value).toBe('abXcd')
    expect(textarea.selectionStart).toBe(3)
    expect(textarea.selectionEnd).toBe(3)
  })

  it('uses one history group for every debounced save in the same focus session', async () => {
    const persist = createPersist()
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      textarea.focus()
      enterValue(textarea, '第一次保存')
      vi.advanceTimersByTime(400)
    })
    await act(async () => {
      enterValue(textarea, '第二次保存')
      vi.advanceTimersByTime(400)
    })

    const firstGroup = persist.mock.calls[0][2]
    expect(firstGroup).toMatch(/^property:node-first:/)
    expect(persist.mock.calls[1][2]).toBe(firstGroup)
  })

  it('keeps the draft and caret after debounce while persistence and stale projections are in flight', async () => {
    let finishSave!: (result: { revision: number }) => void
    const persist = vi.fn(() => new Promise<{ revision: number }>((resolve) => { finishSave = resolve }))
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      textarea.focus()
      enterValue(textarea, 'abXcd')
      vi.advanceTimersByTime(400)
    })
    textarea.setSelectionRange(3, 3)
    await act(async () => root.render(<DraftHarness node={{ ...firstNode }} persist={persist} />))
    expect(textarea.value).toBe('abXcd')
    expect(textarea.selectionStart).toBe(3)

    // Blur must not expose the old projection while the write is still pending.
    await act(async () => textarea.blur())
    await act(async () => root.render(<DraftHarness node={{ ...firstNode }} persist={persist} />))
    expect(textarea.value).toBe('abXcd')
    await act(async () => finishSave({ revision: 2 }))
    await act(async () => root.render(<DraftHarness node={{ ...firstNode }} persist={persist} />))
    expect(textarea.value).toBe('abXcd')
    await act(async () => {
      root.render(<DraftHarness node={{ ...firstNode, description: 'abXcd' }} persist={persist} revision={2} />)
    })
    expect(textarea.value).toBe('abXcd')
    await act(async () => root.render(
      <DraftHarness node={{ ...firstNode, description: '确认保存后的外部修改' }} persist={persist} revision={3} />,
    ))
    expect(textarea.value).toBe('确认保存后的外部修改')
  })

  it('does not replace a newer edit with the acknowledgement of an earlier save', async () => {
    const persist = createPersist()
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      textarea.focus()
      enterValue(textarea, 'abXcd')
      vi.advanceTimersByTime(400)
    })
    await act(async () => {
      enterValue(textarea, 'abXYcd')
      vi.advanceTimersByTime(400)
    })
    textarea.setSelectionRange(4, 4)
    await act(async () => root.render(
      <DraftHarness node={{ ...firstNode, description: 'abXcd' }} persist={persist} />,
    ))
    expect(textarea.value).toBe('abXYcd')
    expect(textarea.selectionStart).toBe(4)
  })

  it('accepts external changes when not editing', async () => {
    const persist = createPersist()
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    await act(async () => root.render(
      <DraftHarness node={{ ...firstNode, description: '外部修改' }} persist={persist} />,
    ))
    expect(container.querySelector('textarea')?.value).toBe('外部修改')
  })

  it('releases a saved draft when React skips its exact acknowledgement projection', async () => {
    const persist = createPersist()
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => { enterValue(textarea, '已保存的草稿'); vi.advanceTimersByTime(400) })
    expect(textarea.value).toBe('已保存的草稿')
    await act(async () => root.render(
      <DraftHarness node={{ ...firstNode, description: '更新的外部修改' }} persist={persist} revision={3} />,
    ))
    expect(textarea.value).toBe('更新的外部修改')
    await act(async () => root.render(
      <DraftHarness node={{ ...firstNode, description: '再次修改' }} persist={persist} revision={4} />,
    ))
    expect(textarea.value).toBe('再次修改')
  })

  it('reconciles when the latest projection arrives before the write response', async () => {
    let resolve!: (result: { revision: number }) => void
    const persist = vi.fn(() => new Promise<{ revision: number }>((done) => { resolve = done }))
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => { enterValue(textarea, '本地'); vi.advanceTimersByTime(400) })
    await act(async () => root.render(
      <DraftHarness node={{ ...firstNode, description: '外部较新版本' }} persist={persist} revision={3} />,
    ))
    expect(textarea.value).toBe('本地')
    await act(async () => resolve({ revision: 2 }))
    expect(textarea.value).toBe('外部较新版本')
  })

  it('reconciles an external change on blur when there is no unacknowledged local edit', async () => {
    const persist = createPersist()
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => textarea.focus())
    await act(async () => root.render(
      <DraftHarness node={{ ...firstNode, description: '外部修改' }} persist={persist} />,
    ))
    expect(textarea.value).toBe('abcd')
    await act(async () => textarea.blur())
    expect(textarea.value).toBe('外部修改')
    expect(persist).not.toHaveBeenCalled()
  })

  it('does not retry an obsolete failed save over newer unsaved text', async () => {
    let failSave!: (error: Error) => void
    const persist = createPersist()
    persist.mockImplementationOnce(() => new Promise<{ revision: number }>((_resolve, reject) => { failSave = reject }))
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      textarea.focus()
      enterValue(textarea, '旧草稿')
      vi.advanceTimersByTime(400)
    })
    await act(async () => enterValue(textarea, '新草稿'))
    await act(async () => failSave(new Error('fixture write failed')))
    await act(async () => textarea.blur())
    expect(persist.mock.calls.map((call) => call[1])).toEqual([
      { description: '旧草稿' }, { description: '新草稿' },
    ])
    expect(textarea.value).toBe('新草稿')
  })

  it('does not flush before debounce just because the persistence callback was recreated', async () => {
    const persist = createPersist()
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => enterValue(textarea, 'abXcd'))
    await act(async () => root.render(
      <DraftHarness node={{ ...firstNode }} persist={(...args) => persist(...args)} />,
    ))
    expect(persist).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(400))
    expect(persist).toHaveBeenCalledOnce()
  })

  it('flushes the previous node before switching drafts', async () => {
    const persist = createPersist()
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => enterValue(textarea, '尚未到防抖时间'))

    await act(async () => root.render(<DraftHarness node={secondNode} persist={persist} />))

    expect(persist).toHaveBeenCalledWith(
      'node-first', { description: '尚未到防抖时间' }, undefined,
    )
    expect(textarea.value).toBe('第二描述')
  })

  it('waits for input method composition to finish before scheduling a save', async () => {
    const persist = createPersist()
    await act(async () => root.render(<DraftHarness node={firstNode} persist={persist} />))
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      enterValue(textarea, '中文输入')
      vi.advanceTimersByTime(1_000)
    })
    expect(persist).not.toHaveBeenCalled()

    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      vi.advanceTimersByTime(400)
    })
    expect(persist).toHaveBeenCalledWith('node-first', { description: '中文输入' }, undefined)
  })
})
