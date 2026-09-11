import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runProjectCommand } from './cli.mjs'
import { parseQueryLanguage } from './symbol-language.mjs'
import { applyTextHunks, parseTextPatch } from './text-patch.mjs'
import { openLocalProject, saveProjectSnapshot } from '../../services/project-store.mjs'

const roots = []
const markdown = `---
id-map:
  文案: { type: $, id: node_text }
---
<project-structure>
# 项目
  $文案
</project-structure>`

async function projectRoot(source = markdown) {
  const root = await mkdtemp(join(tmpdir(), 'graphvideo-project-cli-'))
  roots.push(root)
  await openLocalProject(root)
  await saveProjectSnapshot(root, { markdown: source, nodes: [] })
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('GraphVideo native project CLI', () => {
  it('parses the single compact selector syntax', () => {
    expect(parseQueryLanguage([
      'node_a,角色 :: dc',
      '$文案,@首帧 :: id,history,current',
    ].join('\n'))).toEqual([
      {
        line: 1,
        fields: ['description', 'content'],
        selectors: [
          { raw: 'node_a', isWildcard: false, symbol: null, title: 'node_a' },
          { raw: '角色', isWildcard: false, symbol: null, title: '角色' },
        ],
      },
      {
        line: 2,
        fields: ['id', 'history', 'currentVersion'],
        selectors: [
          { raw: '$文案', isWildcard: false, symbol: '$', title: '文案' },
          { raw: '@首帧', isWildcard: false, symbol: '@', title: '首帧' },
        ],
      },
    ])
    expect(parseQueryLanguage('[@首帧] :: d')[0].selectors[0]).toEqual({
      raw: '[@首帧]', isWildcard: false, symbol: '@', title: '首帧',
    })
    expect(() => parseQueryLanguage('node_a;node_b :: d')).toThrow('只支持逗号')
    expect(parseQueryLanguage('node_a :: mg')[0].fields).toEqual(['model', 'generationConfig'])
  })

  it('parses and applies context text patches without replacing the whole field', () => {
    const updates = parseTextPatch(`*** Begin Patch
*** Update Node: node_text content
@@
 第一行
-第二行
+修改后的第二行
 第三行
*** End Patch`)
    expect(updates[0]).toMatchObject({ id: 'node_text', field: 'content' })
    expect(applyTextHunks('第一行\n第二行\n第三行', updates[0].hunks, '正文'))
      .toBe('第一行\n修改后的第二行\n第三行')
    expect(() => applyTextHunks('重复\n重复', [[
      { kind: '-', text: '重复' }, { kind: '+', text: '修改' },
    ]], '正文')).toThrow('匹配多处')
  })

  it('runs, queries and edits through compact symbolic output', async () => {
    const root = await projectRoot()
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await expect(runProjectCommand(['run'], environment)).resolves.toContain('= run nodes=1')
    await expect(runProjectCommand([
      'query', 'node_text,missing :: nc',
    ], environment)).resolves.toBe('$文案 {i=node_text}\n  n+ "文案"\n  c-\n? missing')
    await runProjectCommand(['edit', 'node_text', 'description', '开场，雨中'], environment)
    await runProjectCommand(['edit', 'node_text', 'content', '雨夜，地铁'], environment)
    await expect(runProjectCommand([
      'query', '$文案 :: dc',
    ], environment)).resolves.toBe(
      '$文案 {i=node_text}\n  d+ |\n    开场，雨中'
      + '\n  c+ |\n    雨夜，地铁',
    )
  })

  it('returns an unnumbered long-text block and applies a patch file', async () => {
    const root = await projectRoot()
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)
    await runProjectCommand([
      'edit', 'node_text', 'content', '第一行\n第二行\n第三行',
    ], environment)
    await expect(runProjectCommand(['query', 'node_text :: c'], environment)).resolves.toContain(
      'c+ |\n    第一行\n    第二行\n    第三行',
    )
    const patchPath = join(root, 'change.patch')
    await writeFile(patchPath, `*** Begin Patch
*** Update Node: node_text content
@@
 第一行
-第二行
+新的第二行
 第三行
*** End Patch\n`)
    await expect(runProjectCommand(['patch', patchPath], environment))
      .resolves.toContain('= patch nodes=1')
    await expect(runProjectCommand(['query', 'node_text :: c'], environment))
      .resolves.toContain('    新的第二行')
  })

  it('returns a Markdown Logic tree with compact field states on overview and clean tree on structure', async () => {
    const root = await projectRoot()
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)
    await expect(runProjectCommand(['structure'], environment)).resolves.toBe(
      '#项目\n  $文案',
    )
    await expect(runProjectCommand(['overview'], environment)).resolves.toBe(
      '#项目\n  $文案 {d- c- h- v-}',
    )
  })

  it('accepts several query lines with multiple IDs or names per line', async () => {
    const root = await projectRoot()
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)
    const result = await runProjectCommand([
      'query', 'node_text,文案 :: i', '$文案 :: d',
    ], environment)
    expect(result.match(/\$文案 \{i=node_text\}/g)).toHaveLength(3)
    expect(result).toContain('  i+ "node_text"')
    expect(result).toContain('  d-')
  })

  it('accepts a file for batch edits', async () => {
    const root = await projectRoot()
    const input = join(root, 'updates.json')
    await writeFile(input, JSON.stringify([
      { id: 'node_text', fields: { content: '批量正文' } },
    ]))
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)
    await expect(runProjectCommand(['edit-file', input], environment))
      .resolves.toContain('$文案 {i=node_text d- c+')
  })

  it('reads and replaces structure and node fields through CLI', async () => {
    const root = await projectRoot()
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)

    // structure get
    await expect(runProjectCommand(['structure'], environment)).resolves.toContain('#项目')

    // structure replace
    await runProjectCommand([
      'structure', 'replace',
      'id-map:\n  文案: { type: $, id: node_text }',
      'id-map:\n  文案: { type: $, id: node_text }\n  首帧: { type: @, id: node_image }',
    ], environment)
    await runProjectCommand([
      'structure', 'replace',
      '  $文案',
      '  $文案\n  @首帧',
    ], environment)

    const overview = await runProjectCommand(['structure', 'all'], environment)
    expect(overview).toContain('$文案')
    expect(overview).toContain('@首帧')

    // node field targeted replace
    await runProjectCommand(['edit', 'node_image', 'prompt', 'model: nano-banana\nprompt: close up portrait, neon lights'], environment)
    const replaced = await runProjectCommand(['replace', 'node_image', 'prompt', 'neon lights', 'sunset glow'], environment)
    expect(replaced).toContain('= replace nodes=1')
    const queried = await runProjectCommand(['query', 'node_image :: p'], environment)
    expect(queried).toContain('sunset glow')
  })

  it('supports structure resolve CLI command for historical conflicts', async () => {
    const root = await projectRoot()
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)
    const historyEmpty = await runProjectCommand(['history', 'list'], environment)
    expect(historyEmpty).toContain('0 个节点')
  })

  it('supports graphvideo write for pure Markdown text input without blocking and run for stepping', async () => {
    const root = await projectRoot()
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    const result = await runProjectCommand(['write', '<project-structure>\n#新项目\n  $第一幕\n    @首帧\n</project-structure>'], environment)
    expect(result).toContain('= write')
    const runResult = await runProjectCommand(['run'], environment)
    expect(runResult).toContain('= run nodes=2')
    const structure = await runProjectCommand(['structure', 'all'], environment)
    expect(structure).toBe('#新项目\n  $第一幕\n    @首帧')
  })

  it('supports bare outline in graphvideo write and stepping via run', async () => {
    const root = await projectRoot()
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    const bareOutline = `#大纲
  $第一幕
  @首帧画面`
    const result = await runProjectCommand(['write', bareOutline], environment)
    expect(result).toContain('= write')

    const runResult = await runProjectCommand(['run'], environment)
    expect(runResult).toContain('= run nodes=2')

    const queryResult = await runProjectCommand(['query', '[$第一幕],[@首帧画面] :: id'], environment)
    expect(queryResult).toContain('第一幕')
    expect(queryResult).toContain('首帧画面')
  })

  it('supports multi-field editing in a single graphvideo edit command', async () => {
    const root = await projectRoot()
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)

    const editResult = await runProjectCommand([
      'edit', 'node_text',
      'd', '文案说明',
      'c', '正文内容',
    ], environment)
    expect(editResult).toContain('= edit nodes=1')

    const queryResult = await runProjectCommand(['query', 'node_text :: dc'], environment)
    expect(queryResult).toContain('文案说明')
    expect(queryResult).toContain('正文内容')
  })

  it('supports structured --json output across query, structure, and history', async () => {
    const root = await projectRoot()
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)

    const jsonQuery = await runProjectCommand(['query', 'node_text :: dc', '--json'], environment)
    const parsedQuery = JSON.parse(jsonQuery)
    expect(parsedQuery).toHaveProperty('lines')
    expect(Array.isArray(parsedQuery.lines)).toBe(true)

    const jsonStructure = await runProjectCommand(['structure', 'all', '--json'], environment)
    const parsedStructure = JSON.parse(jsonStructure)
    expect(parsedStructure).toHaveProperty('lines')

    const jsonHistory = await runProjectCommand(['history', 'list', '--json'], environment)
    const parsedHistory = JSON.parse(jsonHistory)
    expect(parsedHistory).toHaveProperty('retained')
  })

  it('exposes a compact help summary without requiring a project via help, --help, and -h', async () => {
    await expect(runProjectCommand(['help'], {})).resolves.toContain('graphvideo structure')
    await expect(runProjectCommand(['--help'], {})).resolves.toContain('graphvideo structure')
    await expect(runProjectCommand(['-h'], {})).resolves.toContain('graphvideo structure')
  })

  it('supports natural selectors in patch without requiring internal node IDs', async () => {
    const root = await projectRoot(`
<project-structure>
#项目
  $桥接测试节点
  @首帧
</project-structure>
`)
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)

    const patchContent = `*** Begin Patch
*** Update Node: [$桥接测试节点] description
@@
+这是通过自然选择器打入的描述
*** Update Node: [@首帧] prompt
@@
+model: test-model
+prompt: sunset in city
*** End Patch`

    const patchFile = join(root, 'test.patch')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(patchFile, patchContent, 'utf8')

    const fileResult = await runProjectCommand(['patch', patchFile], environment)
    expect(fileResult).toContain('= patch nodes=2')

    const queried = await runProjectCommand(['query', '[$桥接测试节点] :: d', '[@首帧] :: p'], environment)
    expect(queried).toContain('这是通过自然选择器打入的描述')
    expect(queried).toContain('model: test-model')
  })

  it('preserves multi-line complex YAML prompts with internal keys during graphvideo edit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphvideo-project-cli-yaml-'))
    roots.push(root)
    await openLocalProject(root)
    await saveProjectSnapshot(root, { markdown: '<project-structure>\n#项目\n  @首帧\n</project-structure>', nodes: [] })
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)

    const complexYaml = `---
model: minimax-h3-video
prompt: [@主角阿橘] 站在雨夜霓虹街道下
description: 雨夜高潮镜头
steps: 30
cfg_scale: 7.0`

    await runProjectCommand(['edit', '[@首帧]', 'p', complexYaml], environment)

    const queried = await runProjectCommand(['query', '[@首帧] :: p'], environment)
    expect(queried).toContain('model: minimax-h3-video')
    expect(queried).toContain('prompt: [@主角阿橘]')
    expect(queried).toContain('description: 雨夜高潮镜头')
    expect(queried).toContain('cfg_scale: 7.0')
  })

  it('completes the 4-step write -> run conflict -> resolve -> active lifecycle cleanly without loops', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphvideo-project-loop-test-'))
    roots.push(root)
    await openLocalProject(root)
    await saveProjectSnapshot(root, { markdown: '<project-structure>\n#项目\n  @主角阿橘\n</project-structure>', nodes: [] })
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)
    await runProjectCommand(['edit', '[@主角阿橘]', 'p', 'model: nano\nprompt: hero'], environment)

    // Step 1: Retire @主角阿橘
    await runProjectCommand(['write', '<project-structure>\n#项目\n  $文案\n</project-structure>'], environment)
    await runProjectCommand(['run'], environment)

    // Step 2: Write new outline containing @主角阿橘 (write NEVER blocks)
    const writeResult = await runProjectCommand(['write', '<project-structure>\n#项目\n  $文案\n  @主角阿橘\n</project-structure>'], environment)
    expect(writeResult).toContain('= write')

    // Step 3: Run detects conflict
    const runResult = await runProjectCommand(['run'], environment)
    expect(runResult).toContain('! conflict [["主角阿橘"]]')

    // Step 4: Resolve via inherit
    const resolveResult = await runProjectCommand(['structure', 'resolve', '[["主角阿橘", "inherit"]]'], environment)
    expect(resolveResult).toContain('= run nodes=2')

    // Step 5: Verify all nodes active and no further conflict
    const finalRun = await runProjectCommand(['run'], environment)
    expect(finalRun).toContain('= run nodes=2')
    const finalStructure = await runProjectCommand(['structure', 'all'], environment)
    expect(finalStructure).toContain('@主角阿橘')
  })

  it('correctly parses multiple edit fields in a single command and loads prompt from file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'graphvideo-project-multi-edit-'))
    roots.push(root)
    await openLocalProject(root)
    await saveProjectSnapshot(root, { markdown: '<project-structure>\n#项目\n  @主角阿橘\n</project-structure>', nodes: [] })
    const environment = { GRAPHVIDEO_PROJECT_ROOT: root }
    await runProjectCommand(['run'], environment)

    // Test 1: Single command editing both description and prompt
    await runProjectCommand([
      'edit', '[@主角阿橘]',
      'description', '一只微胖的橘白猫',
      'prompt', '---\nmodel: nano-banana-image\naspectRatio: 16:9\n---\n真实橘猫主角立绘',
    ], environment)

    const queryRes1 = await runProjectCommand(['query', '[@主角阿橘] :: dp'], environment)
    expect(queryRes1).toContain('一只微胖的橘白猫')
    expect(queryRes1).toContain('model: nano-banana-image')
    expect(queryRes1).toContain('真实橘猫主角立绘')

    // Test 2: Edit prompt from file
    const promptFile = join(root, 'test-prompt.yaml')
    await writeFile(promptFile, '---\nmodel: flux-dev\naspectRatio: 9:16\n---\n高清晰度赛博朋克猫咪', 'utf8')
    await runProjectCommand(['edit', '[@主角阿橘]', 'prompt', promptFile], environment)

    const queryRes2 = await runProjectCommand(['query', '[@主角阿橘] :: dp'], environment)
    expect(queryRes2).toContain('model: flux-dev')
    expect(queryRes2).toContain('高清晰度赛博朋克猫咪')
  })
})
