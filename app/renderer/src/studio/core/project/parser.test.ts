import { describe, expect, it } from 'vitest'
import { parseProject } from './parser'

const sample = `---
id-map:
  剧本: { type: $, id: node_script }
  镜头: { type: %, id: node_shot }
  画面: { type: @, id: node_frame }
---
<project-structure>
# 项目
  $剧本
    %镜头
      @画面
</project-structure>`

describe('parseProject', () => {
  it('parses stable ids, types and semantic relations', () => {
    const parsed = parseProject(sample)
    expect(parsed.issues).toEqual([])
    expect(parsed.declarations.map((node) => node.id)).toEqual([
      'node_script', 'node_shot', 'node_frame',
    ])
    const script = parsed.tree[0].children[0]
    const shot = script.children[0]
    expect(shot.relation).toBe('content')
    expect(shot.children[0].relation).toBe('dependency')
  })

  it('parses pure markdown without id-map and auto-allocates declaration key', () => {
    const parsed = parseProject('<project-structure>\n$未映射\n</project-structure>')
    expect(parsed.declarations[0].id).toBe('auto:$:未映射')
    expect(parsed.issues).toEqual([])
  })

  it('creates style as a textual payload while keeping dependency semantics', () => {
    const parsed = parseProject(`---
id-map:
  风格: { type: &, id: node_style }
  参考图: { type: @, id: node_reference }
---
<project-structure>
&风格
  @参考图
</project-structure>`)
    expect(parsed.declarations[0]).toMatchObject({
      id: 'node_style', type: 'style', content: '', history: [],
    })
    expect(parsed.declarations[0]).not.toHaveProperty('prompt')
    expect(parsed.tree[0].children[0].relation).toBe('dependency')
  })

  it('reports duplicate ids and prefix conflicts', () => {
    const parsed = parseProject(`---
id-map:
  A: { type: @, id: same_id }
  B: { type: %, id: same_id }
---
<project-structure>
@A
@B
</project-structure>`)
    expect(parsed.issues.map((issue) => issue.code)).toEqual([
      'duplicate-id',
      'type-mismatch',
    ])
  })

  it('rejects ids that cannot be used as node directory names', () => {
    const parsed = parseProject(`---
id-map:
  非法: { type: @, id: node:unsafe }
---
<project-structure>
@非法
</project-structure>`)
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'invalid-id' }))
  })

  it('only parses nodes inside the XML project structure region', () => {
    const parsed = parseProject(`$外部批注
<project-structure>
  $内部节点
</project-structure>
@外部引用`)
    expect(parsed.declarations).toHaveLength(1)
    expect(parsed.declarations[0].title).toBe('内部节点')
  })

  it('reports a missing project structure region on run', () => {
    const parsed = parseProject('$没有 XML 包裹')
    expect(parsed.issues[0].code).toBe('missing-structure')
    expect(parsed.tree).toEqual([])
  })
})
