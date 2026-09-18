import { describe, expect, it, vi } from 'vitest'
import { isNestedFileDropTarget } from './fileDropTarget'

describe('application file drop routing', () => {
  it('leaves files to a nested drop target without relying on the main document Element class', () => {
    const closest = vi.fn(() => (
      { dataset: { fileDropTarget: 'terminal-path' } } as unknown as Element
    ))
    const foreignDocumentTarget = { closest } as unknown as EventTarget

    expect(isNestedFileDropTarget(foreignDocumentTarget)).toBe(true)
    expect(closest).toHaveBeenCalledWith('[data-file-drop-target]')
    expect(isNestedFileDropTarget({} as EventTarget)).toBe(false)
  })
})
