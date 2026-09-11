import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { discoverAgentTemplates } from '../../../../services/agent-catalog.mjs'

const agentNames = ['director', 'image-prompter', 'planner', 'storyboarder', 'video-prompter']
const agentsRoot = fileURLToPath(new URL('.', import.meta.url))
const mcpInstructionsPath = fileURLToPath(new URL('../../../tools/instructions.md', import.meta.url))

async function markdownSourcesAt(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const sources = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!['.agents', '.git', 'node_modules'].includes(entry.name)) {
        sources.push(...await markdownSourcesAt(resolve(directory, entry.name)))
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      sources.push(await readFile(resolve(directory, entry.name), 'utf8'))
    }
  }
  return sources
}

describe('agent project query policy', () => {
  it('splits image and video prompt ownership without retaining the mixed prompter entry', async () => {
    const [imageSource, videoSource] = await Promise.all([
      readFile(resolve(agentsRoot, 'image-prompter', 'AGENTS.md'), 'utf8'),
      readFile(resolve(agentsRoot, 'video-prompter', 'AGENTS.md'), 'utf8'),
    ])

    expect(imageSource).toContain('独立音频属于资产层')
    expect(imageSource).toContain('视频 `%` 的时间演化、运镜和视频 Prompt 由 `video-prompter` 持有')
    expect(imageSource).toContain('风格推演时，本 Agent 独立管理')
    expect(videoSource).toContain('只编辑视频 `%` 节点的 `prompt`')
    expect(videoSource).toContain('独立音频 `~` 与视觉风格 `&` 的唯一 Prompt Owner')
    await expect(readFile(resolve(agentsRoot, 'prompter', 'AGENTS.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const templates = await discoverAgentTemplates(fileURLToPath(new URL('../..', import.meta.url)))
    const defaultTemplate = templates.find((template) => template.id === 'default')
    expect(defaultTemplate?.agents.map((agent) => agent.id)).toEqual(agentNames)
    await expect(readFile(resolve(agentsRoot, 'image-prompter', 'details', 'visual_style_engineering.md'), 'utf8'))
      .resolves.toContain('Planner 与 `video-prompter` 不参与该模式')
  })

  it('keeps single-camera visibility in the common storyboard rule instead of cat-project preferences', async () => {
    const [storyboardRule, catVideoPreference] = await Promise.all([
      readFile(resolve(agentsRoot, 'storyboarder', 'details', 'storyboard_design.md'), 'utf8'),
      readFile(resolve(agentsRoot, '治愈系萌宠短剧', '视频提示词技术细节.md'), 'utf8'),
    ])

    expect(storyboardRule).toContain('以摄影机当前位置为准，只描述真正看得到的主体、动作和遮挡关系')
    expect(catVideoPreference).not.toContain('以单机位可见性为准')
  })

  it('preserves the existing project capability reference in every role prompt', async () => {
    for (const agentName of agentNames) {
      const source = await readFile(resolve(agentsRoot, agentName, 'AGENTS.md'), 'utf8')
      expect(source, `${agentName}/AGENTS.md`).toContain('GraphVideo MCP')
    }
  })

  it('keeps progressive querying in the MCP operation guide', async () => {
    const source = await readFile(mcpInstructionsPath, 'utf8')
    expect(source).toContain('上下文安全视口协议')
    expect(source).toContain('默认深度 `depth: 1`')
    expect(source).toContain('仅对已锁定的具体节点调用 `query_nodes`')
    expect(source).toContain('MCP 不允许 Agent 绕过 Node 调度')
  })

  it('does not route default prompts through retired skills or model CLI commands', async () => {
    const sources = await markdownSourcesAt(agentsRoot)
    for (const source of sources) {
      expect(source).not.toContain('$graphvideo-')
      expect(source).not.toContain('$agent-document-catalog')
      expect(source).not.toMatch(/graphvideo model (list|get)/)
    }
  })

  it('keeps every default agent on the natural-language navigation layout', async () => {
    for (const agentName of agentNames) {
      const agentPath = resolve(agentsRoot, agentName, 'AGENTS.md')
      const navigationPath = resolve(agentsRoot, agentName, 'NAVIGATION.md')
      const [agentSource, navigationSource] = await Promise.all([
        readFile(agentPath, 'utf8'),
        readFile(navigationPath, 'utf8'),
      ])

      expect(agentSource, `${agentName}/AGENTS.md`).toContain('## 核心品味')
      expect(agentSource, `${agentName}/AGENTS.md`).toContain('## 最重要的行为准则')
      expect(agentSource, `${agentName}/AGENTS.md`).toContain('./NAVIGATION.md')
      expect(navigationSource, `${agentName}/NAVIGATION.md`).toContain('## 导航目录')

      for (const source of [agentSource, navigationSource]) {
        expect(source, `${agentName} entry documents`).not.toMatch(/\|\s*when:/)
        expect(source, `${agentName} entry documents`).not.toMatch(/\|\s*do:/)
        expect(source, `${agentName} entry documents`).not.toContain('&&')
      }
    }
  })
})
