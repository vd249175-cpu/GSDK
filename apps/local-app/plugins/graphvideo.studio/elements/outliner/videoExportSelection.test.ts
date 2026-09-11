import { describe, expect, it } from 'vitest'
import type { ProjectNode, ProjectTreeItem } from '@graphvideo/client-sdk'
import { orderedVideoNodeIds } from './videoExportSelection'

const node = (
  key: string,
  nodeId: string,
  nodeType: 'video' | 'image',
  children: ProjectTreeItem[] = [],
): ProjectTreeItem => ({
  key, kind: 'node', title: key, depth: 0, line: 1, relation: 'structure',
  nodeId, nodeType, symbol: nodeType === 'video' ? '%' : '@', children,
})

describe('Outliner video export selection', () => {
  const nodes: Record<string, ProjectNode> = {
    'video-a': { id: 'video-a', type: 'video', title: '开场', description: '' },
    'video-b': { id: 'video-b', type: 'video', title: '结尾', description: '' },
    'image-a': { id: 'image-a', type: 'image', title: '开场', description: '' },
  }
  it('follows project reading order and removes repeated node references', () => {
    const tree = [
      node('first', 'video-a', 'video', [node('image', 'image-a', 'image')]),
      node('second', 'video-b', 'video'),
      node('reference', 'video-a', 'video'),
    ]
    expect(orderedVideoNodeIds(tree, nodes)).toEqual(['video-a', 'video-b'])
  })

  it('resolves automatic tree identities to canonical video IDs before deduplicating', () => {
    const tree = [
      { ...node('first', 'auto:%:开场', 'video'), title: '开场' },
      { ...node('last', 'unmapped:%:结尾', 'video'), title: '结尾' },
      node('reference', 'video-a', 'video'),
    ]
    expect(orderedVideoNodeIds(tree, nodes)).toEqual(['video-a', 'video-b'])
  })

  it('does not export missing, ambiguous or wrong-type nodes by accident', () => {
    const tree = [
      { ...node('wrong-type', 'image-a', 'video'), title: '开场' },
      { ...node('missing', 'auto:%:不存在', 'video'), title: '不存在' },
      { ...node('ambiguous', 'auto:%:结尾', 'video'), title: '结尾' },
    ]
    expect(orderedVideoNodeIds(tree, {
      ...nodes, 'video-c': { ...nodes['video-b'], id: 'video-c' },
    })).toEqual([])
  })
})
