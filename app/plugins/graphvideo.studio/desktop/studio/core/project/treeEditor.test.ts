import { describe, expect, it } from 'vitest'
import { parseProject } from './parser'
import { copyProjectTreeItem, editProjectTree, flattenProjectTree } from './treeEditor'

const markdown = `<project-structure>
#项目
  $场景
    @画面
  #素材
    @画面
    ~音乐
</project-structure>`

function item(title: string, occurrence = 0) {
  return flattenProjectTree(parseProject(markdown).tree)
    .filter((entry) => entry.title === title)[occurrence]
}

describe('project tree editor', () => {
  it('creates structure labels and typed nodes without id-map', () => {
    const group = editProjectTree(markdown, {
      type: 'create', parentKey: item('项目').key, kind: 'structure', title: '镜头',
    })
    const createdGroup = flattenProjectTree(group.parsed.tree).find((entry) => entry.title === '镜头')!
    const node = editProjectTree(group.markdown, {
      type: 'create', parentKey: createdGroup.key, kind: 'node', title: '镜头一',
      nodeType: 'video', nodeId: 'node-shot-1',
    })

    expect(node.parsed.declarations).toContainEqual(expect.objectContaining({
      title: '镜头一', type: 'video',
    }))
    expect(node.markdown).toContain('%镜头一')
    expect(node.markdown).not.toContain('id-map')
  })

  it('renames every reference to one node without requiring id-map', () => {
    const result = editProjectTree(markdown, {
      type: 'rename', key: item('画面').key, title: '关键帧',
    })
    const references = flattenProjectTree(result.parsed.tree)
      .filter((entry) => entry.title === '关键帧')
    expect(references).toHaveLength(2)
    expect(result.markdown).toContain('@关键帧')
    expect(result.markdown).not.toContain('@画面')
    expect(result.markdown).not.toContain('id-map')
  })

  it('deletes a subtree cleanly from outline', () => {
    const firstReference = editProjectTree(markdown, {
      type: 'delete', key: item('场景').key,
    })
    expect(firstReference.markdown).not.toContain('$场景')
    expect(firstReference.markdown).toContain('~音乐')

    const music = flattenProjectTree(firstReference.parsed.tree)
      .find((entry) => entry.title === '音乐')!
    const removed = editProjectTree(firstReference.markdown, { type: 'delete', key: music.key })
    expect(removed.markdown).not.toContain('~音乐')
  })

  it('reorders a subtree at the drop line without changing its level', () => {
    const scene = item('场景')
    const assets = item('素材')
    const moved = editProjectTree(markdown, {
      type: 'move', key: assets.key, targetKey: scene.key, position: 'before',
    })
    const flat = flattenProjectTree(moved.parsed.tree)
    const movedAssets = flat.find((entry) => entry.title === '素材')!
    expect(movedAssets.depth).toBe(assets.depth)
    expect(movedAssets.children.find((entry) => entry.title === '音乐')?.depth).toBe(2)
    expect(flat.findIndex((entry) => entry.title === '素材'))
      .toBeLessThan(flat.findIndex((entry) => entry.title === '场景'))
  })

  it('adjusts only one item with arrows and leaves its former children at the old parent', () => {
    const assets = item('素材')
    const right = editProjectTree(markdown, {
      type: 'adjust-depth', key: assets.key, direction: 'right', includeChildren: false,
    })
    const rightAssets = flattenProjectTree(right.parsed.tree).find((entry) => entry.title === '素材')!
    expect(rightAssets.depth).toBe(2)
    expect(rightAssets.children).toEqual([])
    expect(flattenProjectTree(right.parsed.tree).find((entry) => entry.title === '音乐')?.depth).toBe(2)

    const scene = item('场景')
    const left = editProjectTree(markdown, {
      type: 'adjust-depth', key: scene.key, direction: 'left', includeChildren: false,
    })
    const leftScene = flattenProjectTree(left.parsed.tree).find((entry) => entry.title === '场景')!
    expect(leftScene.depth).toBe(0)
    expect(leftScene.children).toEqual([])
    expect(left.parsed.tree.find((entry) => entry.title === '项目')?.children
      .some((entry) => entry.title === '画面')).toBe(true)
  })

  it('adjusts an item and its complete subtree with shift plus arrows', () => {
    const assets = item('素材')
    const right = editProjectTree(markdown, {
      type: 'adjust-depth', key: assets.key, direction: 'right', includeChildren: true,
    })
    const rightAssets = flattenProjectTree(right.parsed.tree).find((entry) => entry.title === '素材')!
    expect(rightAssets.depth).toBe(2)
    expect(rightAssets.children.find((entry) => entry.title === '音乐')?.depth).toBe(3)

    const scene = item('场景')
    const left = editProjectTree(markdown, {
      type: 'adjust-depth', key: scene.key, direction: 'left', includeChildren: true,
    })
    const leftScene = flattenProjectTree(left.parsed.tree).find((entry) => entry.title === '场景')!
    expect(leftScene.depth).toBe(0)
    expect(leftScene.children.find((entry) => entry.title === '画面')?.depth).toBe(1)
  })

  it('copies a node as another reference to the same stable id', () => {
    const copied = copyProjectTreeItem(parseProject(markdown).tree, item('音乐').key)
    const result = editProjectTree(markdown, {
      type: 'paste', targetKey: item('场景').key, item: copied,
    })
    const references = flattenProjectTree(result.parsed.tree)
      .filter((entry) => entry.title === '音乐')
    expect(references).toHaveLength(2)
    expect(result.parsed.declarations.filter((node) => node.title === '音乐')).toHaveLength(1)
    expect(references.some((entry) => entry.depth === item('场景').depth)).toBe(true)
  })

  it('copies a structure label with its complete subtree and can paste repeatedly', () => {
    const copied = copyProjectTreeItem(parseProject(markdown).tree, item('素材').key)
    const first = editProjectTree(markdown, {
      type: 'paste', targetKey: item('场景').key, item: copied,
    })
    const target = flattenProjectTree(first.parsed.tree).find((entry) => entry.title === '场景')!
    const second = editProjectTree(first.markdown, {
      type: 'paste', targetKey: target.key, item: copied,
    })
    const copiedGroups = flattenProjectTree(second.parsed.tree)
      .filter((entry) => entry.kind === 'structure' && entry.title === '素材')
    expect(copiedGroups).toHaveLength(3)
    expect(copiedGroups.every((entry) => entry.children.some((child) => child.title === '音乐')))
      .toBe(true)
  })

  it('rejects moves into the source subtree and duplicate node titles', () => {
    expect(() => editProjectTree(markdown, {
      type: 'move', key: item('场景').key, targetKey: item('画面').key, position: 'after',
    })).toThrow('自身内部')
    expect(() => editProjectTree(markdown, {
      type: 'create', parentKey: null, kind: 'node', title: '画面',
      nodeType: 'image', nodeId: 'new-id',
    })).toThrow('已被使用')
  })
})
