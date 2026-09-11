import {
  archiveProjectHistory, editProjectNodes, getProjectOverview, getProjectStructure,
  listProjectHistory, patchProjectNodes, queryProjectNodes, replaceProjectNodeField,
  replaceProjectStructure, renameProjectEntity, resolveProjectHistory, runMarkdownLogic, setProjectStructure,
} from './service.mjs'
import { parseSelector } from './symbol-language.mjs'
import { openLocalProject, saveProjectSnapshot } from '../../electron/project-store.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

const roots = []
const markdown = `<project-structure>
# 项目
  $文案
  @首帧
</project-structure>`

async function projectRoot(source = markdown) {
  const root = await mkdtemp(join(tmpdir(), 'graphvideo-project-service-'))
  roots.push(root)
  await openLocalProject(root)
  await saveProjectSnapshot(root, { markdown: source, nodes: [] })
  return root
}

function request(selectors, fields) {
  return [{ line: 1, fields, selectors }]
}

function bare(raw) {
  return { raw, symbol: null, title: raw }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('GraphVideo native project service', () => {
  it('runs pure Markdown Logic without id-map and auto-allocates invisible IDs', async () => {
    const root = await projectRoot()
    const result = await runMarkdownLogic(root)
    expect(result.applied).toBe(true)
    expect(result.nodeCount).toBe(2)
    // Default structure: pure clean markdown (no status suffixes)
    const structure = await getProjectStructure(root, null, 1, false)
    expect(structure.lines).toEqual([
      '#项目',
      '  $文案',
      '  @首帧',
    ])
    // Optional status mode
    const withStatus = await getProjectStructure(root, null, 1, true)
    expect(withStatus.lines).toContain('  $文案 {d- c- h- v-}')
    expect(withStatus.lines).toContain('  @首帧 {d- p- m- h- v-}')
  })

  it('formats structure with depth limit and marks status only on first occurrence when enabled', async () => {
    const root = await projectRoot(`
<project-structure>
#第一幕
  $剧本
    @角色A
  $分镜
    @角色A
</project-structure>
`)
    await runMarkdownLogic(root)
    // Default depth = 1 (clean): only shows level 0 and level 1 without suffixes
    const depth1 = await getProjectStructure(root, null, 1, false)
    expect(depth1.lines).toEqual([
      '#第一幕',
      '  $剧本',
      '  $分镜',
    ])

    // Status mode with full depth: status only on first occurrence
    const full = await getProjectStructure(root, null, 'all', true)
    expect(full.lines[2]).toBe('    @角色A {d- p- m- h- v-}')
    expect(full.lines[4]).toBe('    @角色A') // No duplicate status flag!
  })

  it('Scenario 1: continues active node without interruption when name is unchanged (@主角 -> @主角)', async () => {
    const root = await projectRoot('<project-structure>\n#项目\n  @主角\n  $文案\n</project-structure>')
    await runMarkdownLogic(root)
    await editProjectNodes(root, [{ id: '[@主角]', fields: { prompt: 'model: banana\nprompt: original hero' } }])

    const initialQuery = await queryProjectNodes(root, [{ line: 1, fields: ['id', 'prompt'], selectors: [parseSelector('[@主角]')] }])
    const initialId = initialQuery.lines[0].selectors[0].matches[0].fields.id
    expect(initialId).toBeTruthy()

    // Submit new markdown keeping @主角 unchanged
    const nextMarkdown = '<project-structure>\n#项目\n  @主角\n  $文案\n  %新镜头\n</project-structure>'
    const submitResult = await setProjectStructure(root, nextMarkdown)
    expect(submitResult.applied).toBe(true)

    // Verify @主角 keeps exact same ID, prompt, and active status
    const nextQuery = await queryProjectNodes(root, [{ line: 1, fields: ['id', 'prompt'], selectors: [parseSelector('[@主角]')] }])
    expect(nextQuery.lines[0].selectors[0].matches[0].fields.id).toBe(initialId)
    expect(nextQuery.lines[0].selectors[0].matches[0].fields.prompt).toContain('original hero')
  })

  it('Scenario 2: creates brand new node when name changes (@主角 -> @主角阿橘) and retires old node into history', async () => {
    const root = await projectRoot('<project-structure>\n#项目\n  @主角\n</project-structure>')
    await runMarkdownLogic(root)
    await editProjectNodes(root, [{ id: '[@主角]', fields: { prompt: 'model: banana\nprompt: old hero asset' } }])

    const queryOld = await queryProjectNodes(root, [{ line: 1, fields: ['id'], selectors: [parseSelector('[@主角]')] }])
    const oldId = queryOld.lines[0].selectors[0].matches[0].fields.id

    // Submit new markdown with @主角阿橘 (no @主角)
    const nextMarkdown = '<project-structure>\n#项目\n  @主角阿橘\n</project-structure>'
    const submitResult = await setProjectStructure(root, nextMarkdown)
    expect(submitResult.applied).toBe(true)

    // Verify @主角阿橘 is a brand new node with fresh ID
    const queryNew = await queryProjectNodes(root, [{ line: 1, fields: ['id', 'prompt'], selectors: [parseSelector('[@主角阿橘]')] }])
    const newId = queryNew.lines[0].selectors[0].matches[0].fields.id
    expect(newId).not.toBe(oldId)
    expect(queryNew.lines[0].selectors[0].matches[0].fields.prompt).toBe('')

    // Verify old @主角 was retired into retainedNodes with asset intact
    const project = await openLocalProject(root)
    expect(project.nodes.map((n) => n.title)).toEqual(['主角阿橘'])
    expect(project.retainedNodes.map((n) => n.title)).toEqual(['主角'])
    expect(project.retainedNodes[0].prompt).toContain('old hero asset')
  })

  it('Scenario 3: detects collision when retired node re-appears, and arbitrates via Option A (Archive History H)', async () => {
    const root = await projectRoot('<project-structure>\n#项目\n  @主角\n</project-structure>')
    await runMarkdownLogic(root)
    await editProjectNodes(root, [{ id: '[@主角]', fields: { prompt: 'model: banana\nprompt: precious old asset' } }])

    // Retire @主角
    await setProjectStructure(root, '<project-structure>\n#项目\n  $文案\n</project-structure>')

    // Re-declare @主角 -> MUST trigger Case 3 conflict
    const collisionMarkdown = '<project-structure>\n#项目\n  $文案\n  @主角\n</project-structure>'
    const conflictResult = await setProjectStructure(root, collisionMarkdown)
    expect(conflictResult.applied).toBe(false)
    expect(conflictResult.issues[0].code).toBe('historical-name-conflict')

    // Arbitrate via Option A: Rename historical asset to 主角_旧版
    const resolved = await resolveProjectHistory(root, [['H', '主角', '主角_旧版']], collisionMarkdown)
    expect(resolved.applied).toBe(true)
    expect(resolved.renamedH).toEqual([{ from: '主角', to: '主角_旧版' }])

    // Verify current active @主角 is a clean, new node
    const queryNewHero = await queryProjectNodes(root, [{ line: 1, fields: ['prompt'], selectors: [parseSelector('[@主角]')] }])
    expect(queryNewHero.lines[0].selectors[0].matches[0].fields.prompt).toBe('')

    // Verify historical asset is safely archived as 主角_旧版
    const project = await openLocalProject(root)
    expect(project.retainedNodes.map((n) => n.title)).toContain('主角_旧版')
    expect(project.retainedNodes.find((n) => n.title === '主角_旧版')?.prompt).toContain('precious old asset')
  })

  it('Scenario 3: detects collision when retired node re-appears, and arbitrates via Option B (Rename Current P)', async () => {
    const root = await projectRoot('<project-structure>\n#项目\n  @主角\n</project-structure>')
    await runMarkdownLogic(root)
    await editProjectNodes(root, [{ id: '[@主角]', fields: { prompt: 'model: banana\nprompt: precious old asset' } }])

    // Retire @主角
    await setProjectStructure(root, '<project-structure>\n#项目\n  $文案\n</project-structure>')

    const collisionMarkdown = '<project-structure>\n#项目\n  $文案\n  @主角\n</project-structure>'
    const conflictResult = await setProjectStructure(root, collisionMarkdown)
    expect(conflictResult.applied).toBe(false)

    // Arbitrate via Option B: Rename current declaration to 主角_新版
    const resolved = await resolveProjectHistory(root, [['P', '主角', '主角_新版']], collisionMarkdown)
    expect(resolved.applied).toBe(true)
    expect(resolved.renamedP).toEqual([{ from: '主角', to: '主角_新版' }])

    // Verify structure contains @主角_新版
    const struct = await getProjectStructure(root, null, 'all', false)
    expect(struct.lines).toContain('  @主角_新版')

    // Verify historical @主角 remains in retainedNodes untouched
    const project = await openLocalProject(root)
    expect(project.retainedNodes.map((n) => n.title)).toContain('主角')
  })

  it('Scenario 3: detects collision when retired node re-appears, and arbitrates via Option C (Inherit & Revive)', async () => {
    const root = await projectRoot('<project-structure>\n#项目\n  @主角\n</project-structure>')
    await runMarkdownLogic(root)
    await editProjectNodes(root, [{ id: '[@主角]', fields: { prompt: 'model: banana\nprompt: precious old asset' } }])

    const queryOld = await queryProjectNodes(root, [{ line: 1, fields: ['id'], selectors: [parseSelector('[@主角]')] }])
    const oldId = queryOld.lines[0].selectors[0].matches[0].fields.id

    // Retire @主角
    await setProjectStructure(root, '<project-structure>\n#项目\n  $文案\n</project-structure>')

    const collisionMarkdown = '<project-structure>\n#项目\n  $文案\n  @主角\n</project-structure>'
    const conflictResult = await setProjectStructure(root, collisionMarkdown)
    expect(conflictResult.applied).toBe(false)

    // Arbitrate via Option C: Inherit and revive historical node
    const resolved = await resolveProjectHistory(root, [['主角', 'inherit']], collisionMarkdown)
    expect(resolved.applied).toBe(true)
    expect(resolved.inherited).toEqual(['主角'])

    // Verify revived @主角 carries original ID and prompt
    const queryRevived = await queryProjectNodes(root, [{ line: 1, fields: ['id', 'prompt'], selectors: [parseSelector('[@主角]')] }])
    expect(queryRevived.lines[0].selectors[0].matches[0].fields.id).toBe(oldId)
    expect(queryRevived.lines[0].selectors[0].matches[0].fields.prompt).toContain('precious old asset')

    const project = await openLocalProject(root)
    expect(project.retainedNodes.length).toBe(0)
  })

  it('supports subtree viewport extraction with depth', async () => {
    const root = await projectRoot(`
<project-structure>
#第一集
  #第一幕
    $剧本一
      @关键帧一
  #第二幕
    $剧本二
</project-structure>
`)
    await runMarkdownLogic(root)
    const viewport = await getProjectStructure(root, '#第一集/#第一幕', 1, false)
    expect(viewport.lines).toContain('#第一幕')
    expect(viewport.lines).toContain('  $剧本一')
    expect(viewport.lines).not.toContain('    @关键帧一')
    expect(viewport.lines).not.toContain('$剧本二')
  })

  it('performs targeted chunk replace on a node prompt and text content with selector', async () => {
    const root = await projectRoot()
    await runMarkdownLogic(root)
    await editProjectNodes(root, [
      { id: '[@首帧]', fields: { prompt: 'model: banana\nprompt: cinematic cyberpunk neon rain' } },
      { id: '[$文案]', fields: { content: '第一段文字\n主角推开门走了进来\n第三段文字' } },
    ])

    await replaceProjectNodeField(
      root,
      '[@首帧]',
      'prompt',
      'neon rain',
      'golden sunset',
    )
    const image = await queryProjectNodes(root, request([{ raw: '[@首帧]', symbol: '@', title: '首帧', isWildcard: false }], ['prompt']))
    expect(image.lines[0].selectors[0].matches[0].fields.prompt)
      .toBe('model: banana\nprompt: cinematic cyberpunk golden sunset')
  })

  it('supports direct child and recursive scoped query wildcards', async () => {
    const root = await projectRoot(`
<project-structure>
# 第一集
  $第一幕
    %镜头一
      @关键帧A
      ~音效A
    %镜头二
      @关键帧B
</project-structure>
`)
    await runMarkdownLogic(root)

    // Direct child video shots under $第一幕
    const shots = await queryProjectNodes(root, request([
      { raw: '$第一幕/%', isWildcard: true, scopePath: '$第一幕', recursive: false, targetSymbol: '%' },
    ], ['title']))
    expect(shots.lines[0].selectors[0].matches.map((m) => m.title)).toEqual(['镜头一', '镜头二'])

    // Recursive all keyframes under $第一幕
    const keyframes = await queryProjectNodes(root, request([
      { raw: '$第一幕/**/@', isWildcard: true, scopePath: '$第一幕', recursive: true, targetSymbol: '@' },
    ], ['title']))
    expect(keyframes.lines[0].selectors[0].matches.map((m) => m.title)).toEqual(['关键帧A', '关键帧B'])

    // Recursive all media under $第一幕
    const allMedia = await queryProjectNodes(root, request([
      { raw: '$第一幕/**', isWildcard: true, scopePath: '$第一幕', recursive: true, targetSymbol: null },
    ], ['title']))
    expect(allMedia.lines[0].selectors[0].matches.map((m) => m.title))
      .toEqual(['镜头一', '关键帧A', '音效A', '镜头二', '关键帧B'])
  })

  it('performs global refactor rename updating both outline and prompt references', async () => {
    const root = await projectRoot(`
<project-structure>
# 通用资产
  @主角阿橘
$第一幕
  %镜头一
    @关键帧一
</project-structure>
`)
    await runMarkdownLogic(root)
    await editProjectNodes(root, [
      { id: '[@关键帧一]', fields: { prompt: 'model: test\nprompt: [@主角阿橘] 站在雨夜中' } },
    ])

    const renameResult = await renameProjectEntity(root, '[@主角阿橘]', '[@主角橘宝]')
    expect(renameResult.node.oldTitle).toBe('主角阿橘')
    expect(renameResult.node.newTitle).toBe('主角橘宝')
    expect(renameResult.affectedReferencesCount).toBe(1)

    // Verify outline was updated
    const struct = await getProjectStructure(root, null, 'all', false)
    expect(struct.lines).toContain('  @主角橘宝')
    expect(struct.lines).not.toContain('@主角阿橘')

    // Verify referenced prompt was updated
    const kf = await queryProjectNodes(root, request([{ raw: '[@关键帧一]', symbol: '@', title: '关键帧一', isWildcard: false }], ['prompt']))
    expect(kf.lines[0].selectors[0].matches[0].fields.prompt).toContain('[@主角橘宝]')
    expect(kf.lines[0].selectors[0].matches[0].fields.prompt).not.toContain('[@主角阿橘]')
  })
})
