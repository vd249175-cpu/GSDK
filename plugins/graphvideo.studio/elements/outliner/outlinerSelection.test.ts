import { describe, expect, it } from 'vitest'
import type { ProjectTreeItem } from '@graphvideo/client-sdk'
import { focusKeyAfterTreeEdit, resolveOutlinerSelection } from './outlinerSelection'

const tree: ProjectTreeItem[] = [{
  key: 'root', kind: 'structure', title: '项目', depth: 0, line: 1,
  relation: 'root', children: [{
    key: 'node-a:0', kind: 'node', title: '首帧', depth: 1, line: 2,
    relation: 'structure', nodeId: 'node-a', nodeType: 'image', symbol: '@', children: [],
  }],
}]

describe('Outliner selection continuity', () => {
  it('keeps the actionable item after keyboard depth changes and drag moves', () => {
    expect(focusKeyAfterTreeEdit({
      type: 'adjust-depth', key: 'node-a:0', direction: 'right', includeChildren: false,
    }, 'node-a:0')).toBe('node-a:0')
    expect(focusKeyAfterTreeEdit({
      type: 'move', key: 'node-a:0', targetKey: 'root', position: 'after',
    }, 'node-a:0')).toBe('node-a:0')
  })

  it('falls back to the project-selected node when a structural key changes', () => {
    expect(resolveOutlinerSelection(tree, 'stale-key', 'node-a')?.key).toBe('node-a:0')
  })
})
