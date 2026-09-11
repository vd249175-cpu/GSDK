import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { openLocalProject, saveProjectSnapshot } from '../../services/project-store.mjs'
import { runMarkdownLogic } from './service.mjs'

const roots = []
const markdown = `---
id-map:
  文案: { type: $, id: node_text }
  角色: { type: @, id: node_image }
---
<project-structure>
# 项目
  $文案
  @角色
</project-structure>`

async function createTestProject(source = markdown) {
  const root = await mkdtemp(join(tmpdir(), 'graphvideo-mcp-test-'))
  roots.push(root)
  await openLocalProject(root)
  await saveProjectSnapshot(root, { markdown: source, nodes: [] })
  await runMarkdownLogic(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('GraphVideo MCP Server', () => {
  it('connects via stdio, lists all tools, and losslessly edits multi-line fields', async () => {
    const project = await createTestProject()
    const serverScript = fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))

    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverScript],
      env: {
        ...process.env,
        GRAPHVIDEO_PROJECT_ROOT: project,
      },
    })

    const client = new Client(
      { name: 'graphvideo-test-client', version: '1.0.0' },
      { capabilities: {} },
    )

    await client.connect(transport)

    try {
      // 1. 验证工具列表
      const { tools } = await client.listTools()
      const toolNames = tools.map((t) => t.name)
      expect(toolNames).toContain('edit_node')
      expect(toolNames).toContain('batch_edit')
      expect(toolNames).toContain('get_structure')
      expect(toolNames).toContain('query_nodes')
      expect(toolNames).toContain('write_markdown')
      expect(toolNames).toContain('replace_node_field')
      expect(toolNames).toContain('rename_entity')
      expect(toolNames).toContain('resolve_conflicts')
      expect(toolNames).toContain('run_logic')
      expect(toolNames).toContain('list_agent_documents')
      expect(toolNames).toContain('list_generation_models')
      expect(toolNames).toContain('resolve_generation_prompt')

      const modelResult = await client.callTool({
        name: 'list_generation_models',
        arguments: { mediaType: 'audio' },
      })
      const modelData = JSON.parse(modelResult.content[0].text)
      expect(modelData.models.every((model) => model.mediaType === 'audio')).toBe(true)
      expect(modelData.models.map((model) => model.id)).toContain('audio-sfx')

      // 2. 验证 get_structure
      const structureRes = await client.callTool({
        name: 'get_structure',
        arguments: { depth: 1 },
      })
      expect(structureRes.isError).toBeFalsy()
      const structureData = JSON.parse(structureRes.content[0].text)
      expect(structureData.lines).toBeDefined()
      expect(structureData.lines[0]).toContain('项目')

      // 3. 验证 edit_node 传递多行特殊文本（彻底解决换行与特殊字符截断）
      const multiLineDescription = `# 导演口述与分镜设计

第一行：夜景俯拍，街道积水。
第二行：“主角点烟”，火光照亮双眼。
特殊符号：$100, 50%, @tag, &style, #heading`

      const editRes = await client.callTool({
        name: 'edit_node',
        arguments: {
          selector: '[$文案]',
          fields: {
            description: multiLineDescription,
            content: '这是正文第一行\n这是正文第二行\n这是正文第三行',
          },
        },
      })
      expect(editRes.isError).toBeFalsy()

      // 4. 验证 query_nodes 读取回来的文本 100% 完整无损
      const queryRes = await client.callTool({
        name: 'query_nodes',
        arguments: {
          query: '[$文案] :: dc',
        },
      })
      expect(queryRes.isError).toBeFalsy()
      const queryData = JSON.parse(queryRes.content[0].text)
      const matchedNode = queryData.lines[0].selectors[0].matches[0]
      expect(matchedNode.fields.description).toBe(multiLineDescription)
      expect(matchedNode.fields.content).toBe('这是正文第一行\n这是正文第二行\n这是正文第三行')

      // 5. 验证 batch_edit
      const batchRes = await client.callTool({
        name: 'batch_edit',
        arguments: {
          updates: [
            {
              selector: '[@角色]',
              fields: {
                description: '角色立绘说明：微胖橘猫',
                prompt: 'model: nano-banana\naspectRatio: 16:9\n---\n橘白相间的猫咪立绘',
              },
            },
          ],
        },
      })
      expect(batchRes.isError).toBeFalsy()

      // 验证批改后的 prompt 换行保存
      const queryPromptRes = await client.callTool({
        name: 'query_nodes',
        arguments: {
          query: '[@角色] :: dp',
        },
      })
      const promptData = JSON.parse(queryPromptRes.content[0].text)
      const matchedRole = promptData.lines[0].selectors[0].matches[0]
      expect(matchedRole.fields.description).toBe('角色立绘说明：微胖橘猫')
      expect(matchedRole.fields.prompt).toContain('model: nano-banana\naspectRatio: 16:9')
    } finally {
      await client.close()
    }
  })
})
