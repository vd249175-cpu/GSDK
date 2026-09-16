import { describe, expect, it } from 'vitest'
import { parseProjectMarkdown } from './markdown-parser'

const markdown = `<project-structure>
# 第一幕
  @ 主视觉
  @ 主视觉
</project-structure>`

describe('domain Markdown parser identities', () => {
  it('generates stable and occurrence-safe IDs without ambient randomness', () => {
    const first = parseProjectMarkdown(markdown)
    const second = parseProjectMarkdown(markdown)
    const firstKeys = [
      first.tree[0].key,
      ...first.tree[0].children.map((item) => item.key),
    ]
    const secondKeys = [
      second.tree[0].key,
      ...second.tree[0].children.map((item) => item.key),
    ]

    expect(secondKeys).toEqual(firstKeys)
    expect(new Set(firstKeys).size).toBe(firstKeys.length)
    expect(first.tree[0].children.map((item) => item.nodeId)).toEqual([
      'auto:@:主视觉',
      'auto:@:主视觉',
    ])
  })
})
