import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseProject } from '../resources/shared/project-parser.mjs'
import {
  importProjectNodeVersion, minimalProjectMarkdown, openLocalProject, persistGraphMetadata, promoteProjectNodeVersion,
  resolveProjectNodeVersionPath, resolveProjectNodeVersionPathSync,
  saveProjectNode, saveProjectSnapshot, saveProjectStructure,
} from './project-store.mjs'

let projectRoot

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'graphvideo-store-'))
})

afterEach(async () => {
  const resolvedRoot = resolve(projectRoot)
  const safeParent = resolve(tmpdir())
  if (resolvedRoot.startsWith(safeParent) && basename(resolvedRoot).startsWith('graphvideo-store-')) {
    await rm(resolvedRoot, { recursive: true, force: true })
  }
})

describe('Electron local project store', () => {
  it('persists Graph metadata through a dedicated SQLite transaction table', async () => {
    await openLocalProject(projectRoot)
    const observation = await persistGraphMetadata(projectRoot, [
      { id: 'scene-1', type: 'scene', title: '第一场' },
      { id: 'shot-1', type: 'shot', title: '镜头一', parentId: 'scene-1' },
    ])

    expect(observation).toMatchObject({
      dbFilePath: '.graphvideo/nodes.sqlite',
      persistedRecordCount: 2,
      byteLength: expect.any(Number),
      contentRef: expect.stringMatching(/^sha256:/),
    })
    const database = new DatabaseSync(join(projectRoot, '.graphvideo', 'nodes.sqlite'))
    try {
      expect(database.prepare('SELECT id, payload_json FROM graph_metadata ORDER BY id').all())
        .toEqual([
          { id: 'scene-1', payload_json: JSON.stringify({ id: 'scene-1', type: 'scene', title: '第一场' }) },
          {
            id: 'shot-1',
            payload_json: JSON.stringify({ id: 'shot-1', type: 'shot', title: '镜头一', parentId: 'scene-1' }),
          },
        ])
    } finally {
      database.close()
    }
  })

  it('synchronously updates nodes table properties (prompt, description, content) via persistGraphMetadata', async () => {
    await saveProjectStructure(projectRoot, {
      markdown: '<project-structure>\n#项目\n  @主角阿橘\n</project-structure>',
      nodes: [
        { id: 'char-1', type: 'image', title: '主角阿橘', prompt: 'old prompt', description: 'old desc' },
      ],
    })

    // Frontend property edit sends updated record through persistGraphMetadata
    await persistGraphMetadata(projectRoot, [
      { id: 'char-1', prompt: 'model: flux\nprompt: new cyber cat', description: 'updated description' },
    ])

    const project = await openLocalProject(projectRoot)
    const charNode = project.nodes.find((n) => n.id === 'char-1')
    expect(charNode).toBeDefined()
    expect(charNode?.prompt).toBe('model: flux\nprompt: new cyber cat')
    expect(charNode?.description).toBe('updated description')
  })

  it('initializes an empty directory as a minimal usable project in SQLite SSOT', async () => {
    const project = await openLocalProject(projectRoot)
    expect(project.markdown).toBe(minimalProjectMarkdown)
    expect(parseProject(project.markdown)).toMatchObject({ declarations: [], issues: [] })
    expect(project.nodes).toEqual([])
    await expect(stat(join(projectRoot, '.graphvideo', 'nodes.sqlite'))).resolves.toBeTruthy()
    await expect(stat(join(projectRoot, 'nodes'))).resolves.toBeTruthy()
    // Verifies physical project.md is NOT created on disk
    await expect(stat(join(projectRoot, 'project.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('creates SQLite and the unified node payload root when a project is opened', async () => {
    const project = await openLocalProject(projectRoot)
    expect(project.nodes).toEqual([])
    await expect(stat(join(projectRoot, '.graphvideo', 'nodes.sqlite'))).resolves.toBeTruthy()
    await expect(stat(join(projectRoot, 'nodes'))).resolves.toBeTruthy()
  })

  it('ignores history entries that do not use the current version object format', async () => {
    await openLocalProject(projectRoot)
    await saveProjectSnapshot(projectRoot, {
      markdown: '@画面',
      nodes: [{
        id: 'node_image', type: 'image', title: '画面', description: '', prompt: '', history: [],
      }],
    })
    const database = new DatabaseSync(join(projectRoot, '.graphvideo', 'nodes.sqlite'))
    try {
      database.prepare('UPDATE nodes SET history_json = ? WHERE id = ?').run(
        JSON.stringify(['nodes/node_image/media/old.png']),
        'node_image',
      )
    } finally {
      database.close()
    }

    const reopened = await openLocalProject(projectRoot)
    expect(reopened.nodes.find((node) => node.id === 'node_image')?.history).toEqual([])
  })

  it('repairs multiple current history flags by keeping the last marked version current', async () => {
    await openLocalProject(projectRoot)
    await saveProjectSnapshot(projectRoot, {
      markdown: '@画面',
      nodes: [{
        id: 'node_image', type: 'image', title: '画面', description: '', prompt: '', history: [],
      }],
    })
    const database = new DatabaseSync(join(projectRoot, '.graphvideo', 'nodes.sqlite'))
    try {
      database.prepare('UPDATE nodes SET history_json = ? WHERE id = ?').run(
        JSON.stringify([
          { id: 'old', relativePath: 'nodes/node_image/media/old.png', current: true },
          { id: 'new', relativePath: 'nodes/node_image/media/new.png', current: true },
        ]),
        'node_image',
      )
    } finally {
      database.close()
    }

    const reopened = await openLocalProject(projectRoot)
    expect(reopened.nodes.find((node) => node.id === 'node_image')?.history
      .map((version) => ({ id: version.id, current: version.current }))).toEqual([
      { id: 'old', current: false },
      { id: 'new', current: true },
    ])
  })

  it('stores node metadata and text content in SQLite as SSOT', async () => {
    await openLocalProject(projectRoot)
    const saved = await saveProjectSnapshot(projectRoot, {
      markdown: '$正文\n@画面',
      nodes: [
        { id: 'node_text', type: 'text', title: '正文', description: '文本', content: '数据库正文' },
        { id: 'node_image', type: 'image', title: '画面', description: '图片', prompt: '霓虹', history: [] },
      ],
    })
    const reopened = await openLocalProject(projectRoot)
    expect(reopened.markdown).toBe('$正文\n@画面')
    expect(reopened.nodes.find((node) => node.id === 'node_text')?.content).toBe('数据库正文')
    expect(reopened.nodes.find((node) => node.id === 'node_image')?.prompt).toBe('霓虹')
    // Asserts physical content.md is NOT created on disk
    await expect(stat(join(projectRoot, 'nodes', 'node_text', 'content.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('updates project structure and content in SQLite without disk content file pollution', async () => {
    await openLocalProject(projectRoot)
    const initial = await saveProjectSnapshot(projectRoot, {
      markdown: '$正文',
      nodes: [{
        id: 'node_text', type: 'text', title: '正文', description: '', content: '原始正文',
      }],
    })

    await saveProjectStructure(projectRoot, {
      markdown: '# 新目录\n  $正文',
      nodes: [{ ...initial.nodes[0], title: '正文新标题', content: '更新后的正文' }],
    })

    const reopened = await openLocalProject(projectRoot)
    expect(reopened.markdown).toBe('# 新目录\n  $正文')
    expect(reopened.nodes[0].title).toBe('正文新标题')
    expect(reopened.nodes[0].content).toBe('更新后的正文')
  })

  it('retires payload-bearing nodes during a structure-only transaction', async () => {
    await openLocalProject(projectRoot)
    await saveProjectSnapshot(projectRoot, {
      markdown: '$保留正文\n@空图片',
      nodes: [
        { id: 'text_kept', type: 'text', title: '保留正文', description: '', content: '已有正文' },
        { id: 'image_empty', type: 'image', title: '空图片', description: '', prompt: '', history: [] },
      ],
    })

    const saved = await saveProjectStructure(projectRoot, {
      markdown: '# 空结构',
      nodes: [],
    })

    expect(saved.nodes).toEqual([])
    expect(saved.retainedNodes.map((node) => node.id)).toEqual(['text_kept'])
    const reopened = await openLocalProject(projectRoot)
    expect(reopened.nodes).toEqual([])
    expect(reopened.retainedNodes.map((node) => node.id)).toEqual(['text_kept'])
  })

  it('updates node text content directly in SQLite', async () => {
    await openLocalProject(projectRoot)
    const first = await saveProjectNode(projectRoot, {
      id: 'node_text',
      type: 'text',
      title: '正文',
      description: '修改后',
      content: '第二版正文',
    })
    const second = await saveProjectNode(projectRoot, { ...first, content: '第三版正文' })
    const reopened = await openLocalProject(projectRoot)
    expect(reopened.nodes[0]).toMatchObject({ description: '修改后', content: '第三版正文' })
  })

  it('imports text versions and updates node content in SQLite', async () => {
    await openLocalProject(projectRoot)
    const source = join(projectRoot, 'replacement.txt')
    await writeFile(source, '导入的新正文', 'utf8')
    const initial = await saveProjectNode(projectRoot, {
      id: 'node_text', type: 'text', title: '正文', description: '', content: '原始正文', history: [],
    })
    expect(initial.history).toHaveLength(0)

    const imported = await importProjectNodeVersion(projectRoot, initial.id, source)
    expect(imported.history).toHaveLength(1)
    expect(imported.history[0].current).toBe(true)
    expect(imported.content).toBe('导入的新正文')
  })

  it('imports text versions and promotes an older version to current content', async () => {
    await openLocalProject(projectRoot)
    const sourceA = join(projectRoot, 'first.txt')
    const sourceB = join(projectRoot, 'second.md')
    await writeFile(sourceA, '第一版正文', 'utf8')
    await writeFile(sourceB, '第二版正文', 'utf8')
    const baseNode = { id: 'node_text', type: 'text', title: '正文', description: '', content: '', history: [] }
    await saveProjectNode(projectRoot, baseNode)
    await importProjectNodeVersion(projectRoot, baseNode.id, sourceA)
    const second = await importProjectNodeVersion(projectRoot, baseNode.id, sourceB)
    expect(second.content).toBe('第二版正文')
    expect(second.history).toHaveLength(2)
    expect(second.history[1].current).toBe(true)

    const promoted = await promoteProjectNodeVersion(projectRoot, baseNode.id, second.history[0].id)
    expect(promoted.content).toBe('第一版正文')
    expect(promoted.history[0].current).toBe(true)
    const reopened = await openLocalProject(projectRoot)
    expect(reopened.nodes[0].content).toBe('第一版正文')
  })

  it('stores style as text and imports Markdown versions', async () => {
    await openLocalProject(projectRoot)
    const source = join(projectRoot, 'style.md')
    await writeFile(source, '# 冷峻蓝调\n\n低饱和青蓝阴影。', 'utf8')
    const styleNode = {
      id: 'node_style', type: 'style', title: '冷峻蓝调', description: '', content: '', history: [],
    }
    await saveProjectNode(projectRoot, styleNode)
    const imported = await importProjectNodeVersion(projectRoot, styleNode.id, source)
    expect(imported.content).toContain('低饱和青蓝阴影')
    expect(imported.history[0]).toMatchObject({ mimeType: 'text/markdown', current: true })
    const reopened = await openLocalProject(projectRoot)
    expect(reopened.nodes[0]).toMatchObject({ type: 'style', content: imported.content })
    expect(reopened.nodes[0]).not.toHaveProperty('prompt')
  })

  it('imports media into the node directory and resolves only registered versions', async () => {
    await openLocalProject(projectRoot)
    const source = join(projectRoot, 'reference.png')
    await writeFile(source, 'image-bytes')
    const imageNode = {
      id: 'node_image', type: 'image', title: '画面', description: '', prompt: '', history: [],
    }
    await saveProjectNode(projectRoot, imageNode)
    const imported = await importProjectNodeVersion(projectRoot, imageNode.id, source)
    const version = imported.history[0]
    expect(version.relativePath).toMatch(/^nodes\/node_image\/media\//)
    const resolvedPath = await resolveProjectNodeVersionPath(projectRoot, imported.id, version.id)
    expect(await readFile(resolvedPath, 'utf8')).toBe('image-bytes')
    expect(resolveProjectNodeVersionPathSync(projectRoot, imported.id, version.id)).toBe(resolvedPath)
    expect(() => resolveProjectNodeVersionPathSync(projectRoot, imported.id, 'missing')).toThrow('不存在')
    await expect(resolveProjectNodeVersionPath(projectRoot, imported.id, 'missing')).rejects.toThrow('不存在')
  })

  it('deletes absent metadata-only nodes but retains nodes with disk text', async () => {
    await openLocalProject(projectRoot)
    await saveProjectSnapshot(projectRoot, {
      markdown: '$正文\n&风格\n@空图片',
      nodes: [
        { id: 'text_kept', type: 'text', title: '正文', description: '', content: '保留文本' },
        { id: 'style_kept', type: 'style', title: '风格', description: '', content: '保留风格', history: [] },
        { id: 'image_empty', type: 'image', title: '空图片', description: '', prompt: '', history: [] },
      ],
    })
    const saved = await saveProjectSnapshot(projectRoot, { markdown: '# 空结构', nodes: [] })
    expect(saved.retainedNodes.map((node) => node.id)).toEqual(['text_kept', 'style_kept'])
    const reopened = await openLocalProject(projectRoot)
    expect(reopened.retainedNodes.map((node) => node.id)).toEqual(['text_kept', 'style_kept'])
  })

  it('retains media-backed ids and rejects reuse by a different node', async () => {
    await openLocalProject(projectRoot)
    const mediaDirectory = join(projectRoot, 'nodes', 'image_kept', 'media')
    await mkdir(mediaDirectory, { recursive: true })
    await writeFile(join(mediaDirectory, 'v1.png'), 'binary')
    await saveProjectSnapshot(projectRoot, {
      markdown: '@原图片',
      nodes: [{ id: 'image_kept', type: 'image', title: '原图片', description: '', prompt: '', history: [] }],
    })
    await saveProjectSnapshot(projectRoot, { markdown: '# 空结构', nodes: [] })
    await expect(saveProjectSnapshot(projectRoot, {
      markdown: '@新图片',
      nodes: [{ id: 'image_kept', type: 'image', title: '新图片', description: '', prompt: '', history: [] }],
    })).rejects.toThrow('已被保留节点')
  })

  it('rejects node ids that cannot be used as safe directory names', async () => {
    await openLocalProject(projectRoot)
    await expect(saveProjectNode(projectRoot, {
      id: '../outside', type: 'text', title: '越界', description: '', content: '内容', history: [],
    })).rejects.toThrow('只能包含 ASCII')
  })

  it('rejects opening a non-existent project directory and does not create it', async () => {
    const nonExistentPath = join(projectRoot, 'missing-project-directory')
    await expect(openLocalProject(nonExistentPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(nonExistentPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('rejects opening a project path that is a file instead of a directory', async () => {
    const filePath = join(projectRoot, 'project-file.txt')
    await writeFile(filePath, 'some file content', 'utf8')
    await expect(openLocalProject(filePath)).rejects.toMatchObject({
      code: 'ENOTDIR',
    })
  })
})
