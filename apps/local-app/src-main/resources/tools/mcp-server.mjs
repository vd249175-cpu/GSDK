#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { fileURLToPath } from 'node:url'
import {
  editProjectNodes,
  getProjectOverview,
  getProjectStructure,
  queryProjectNodes,
  renameProjectEntity,
  replaceProjectNodeField,
  resolveProjectHistory,
  runMarkdownLogic,
  writeProjectMarkdown,
} from './service.mjs'
import { parseQueryLanguage } from './symbol-language.mjs'
import { listGenerationModels, resolveGenerationPrompt } from '../../services/generation-model-store.mjs'
import { catalogAgentDocuments } from './document-catalog.mjs'

export function createGraphVideoMcpServer(projectRoot = process.env.GRAPHVIDEO_PROJECT_ROOT) {
  const server = new McpServer({
    name: 'graphvideo-project',
    version: '1.0.0',
  })

  function requireProjectRoot() {
    const root = projectRoot || process.env.GRAPHVIDEO_PROJECT_ROOT
    if (!root) throw new Error('缺少环境变量 GRAPHVIDEO_PROJECT_ROOT，无法定位当前项目')
    return root
  }

  function generationModelsRoot() {
    return process.env.GRAPHVIDEO_GENERATION_MODELS_ROOT
      || fileURLToPath(new URL('../generation-models', import.meta.url))
  }

  async function generationModelCatalog() {
    return listGenerationModels(generationModelsRoot())
  }

  // 1. edit_node (原子编辑节点字段，天然支持多行文本与换行符)
  server.tool(
    'edit_node',
    '修改指定节点的内容、导演口述或生成提示词。原生支持包含多行换行、Markdown 标题及任意特殊字符的长文本，零转义损失。',
    {
      selector: z.string().describe("节点选择器，例如 '[@主角阿橘]'、'[$第一幕]'、'[%激战镜头]' 或节点 ID"),
      fields: z.object({
        description: z.string().optional().describe('导演口述、场景氛围与视觉说明（支持多行 Markdown）'),
        content: z.string().optional().describe('正文剧本、对白与文本内容'),
        prompt: z.string().optional().describe('用于生成模型的 YAML / 提示词模板'),
      }).describe('要更新的字段键值对'),
    },
    async ({ selector, fields }) => {
      try {
        const root = requireProjectRoot()
        const result = await editProjectNodes(root, [{ id: selector, fields }])
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `edit_node 失败: ${error?.message || String(error)}` }],
        }
      }
    },
  )

  // 2. batch_edit (批量更新多个节点)
  server.tool(
    'batch_edit',
    '在一个原子事务中批量更新多个节点的字段，适合导演或编剧 Agent 批量重写整幕分镜或资产。',
    {
      updates: z.array(z.object({
        selector: z.string().describe("节点选择器，例如 '[@主角]'"),
        fields: z.object({
          description: z.string().optional(),
          content: z.string().optional(),
          prompt: z.string().optional(),
        }).passthrough().describe('要更新的字段键值对'),
      })).describe('批量更新列表'),
    },
    async ({ updates }) => {
      try {
        const root = requireProjectRoot()
        const nodeUpdates = updates.map((u) => ({ id: u.selector, fields: u.fields }))
        const result = await editProjectNodes(root, nodeUpdates)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `batch_edit 失败: ${error?.message || String(error)}` }],
        }
      }
    },
  )

  // 3. get_structure (上下文安全的大纲视口查询)
  server.tool(
    'get_structure',
    '以视口方式安全查询项目大纲树结构，默认深度为 1，有效防止超大项目刷屏塞爆上下文。',
    {
      scope: z.string().optional().describe("子树范围路径，如 '#第一集/$第一幕'、'#通用资产/#角色'。留空表示根目录"),
      depth: z.union([z.number().int().min(1), z.literal('all')]).default(1).describe("展开深度限制，默认为 1。小范围子树可传 'all'"),
      includeStatus: z.boolean().default(false).describe('是否包含 {d+ c- p+} 字段就绪状态标记'),
    },
    async ({ scope, depth, includeStatus }) => {
      try {
        const root = requireProjectRoot()
        const structure = await getProjectStructure(root, scope || null, depth, includeStatus)
        return {
          content: [{ type: 'text', text: JSON.stringify(structure, null, 2) }],
        }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `get_structure 失败: ${error?.message || String(error)}` }],
        }
      }
    },
  )

  // 4. query_nodes (紧凑符号语言节点检索)
  server.tool(
    'query_nodes',
    '使用紧凑符号语言精确查询指定节点或子集的具体字段（d:说明, c:正文, p:提示词, m:模型, h:历史版本, v:当前媒体）。',
    {
      query: z.string().describe("查询语句，例如 '[@主角],[%激战残影] :: dcp' 或 '$第一幕/% :: p'"),
    },
    async ({ query }) => {
      try {
        const root = requireProjectRoot()
        const requests = parseQueryLanguage(query)
        const result = await queryProjectNodes(root, requests)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `query_nodes 失败: ${error?.message || String(error)}` }],
        }
      }
    },
  )

  // 5. write_markdown (全量大纲纯文本写入)
  server.tool(
    'write_markdown',
    '全量写入纯文本大纲 Markdown，自动同步更新底层 SQLite 与桌面端 UI，零拦截且绝对保证文本落盘。',
    {
      markdown: z.string().describe('完整的 Markdown 大纲文本（支持纯净大纲与 > 描述语法）'),
    },
    async ({ markdown }) => {
      try {
        const root = requireProjectRoot()
        const result = await writeProjectMarkdown(root, markdown)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `write_markdown 失败: ${error?.message || String(error)}` }],
        }
      }
    },
  )

  // 6. replace_node_field (精准局部文本替换)
  server.tool(
    'replace_node_field',
    '对指定节点字段中的局部文本进行精确匹配与替换。',
    {
      selector: z.string().describe('目标节点选择器'),
      field: z.enum(['description', 'content', 'prompt']).describe('要替换的目标字段'),
      target: z.string().describe('被替换的原始目标文本'),
      replacement: z.string().describe('用于替换的新文本'),
    },
    async ({ selector, field, target, replacement }) => {
      try {
        const root = requireProjectRoot()
        const result = await replaceProjectNodeField(root, selector, field, target, replacement)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `replace_node_field 失败: ${error?.message || String(error)}` }],
        }
      }
    },
  )

  // 7. rename_entity (全局级联重命名)
  server.tool(
    'rename_entity',
    '重命名大纲中的实体节点，并自动级联更新项目中所有下游 Prompt 中对该实体的引用标签。',
    {
      selector: z.string().describe("原节点选择器，例如 '[@主角阿橘]'"),
      newName: z.string().describe("新节点选择器，例如 '[@主角橘宝]'"),
    },
    async ({ selector, newName }) => {
      try {
        const root = requireProjectRoot()
        const result = await renameProjectEntity(root, selector, newName)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `rename_entity 失败: ${error?.message || String(error)}` }],
        }
      }
    },
  )

  // 8. resolve_conflicts (历史保留资产冲突一键核销)
  server.tool(
    'resolve_conflicts',
    '原子核销大纲修改引发的历史资产同名冲突。',
    {
      actions: z.string().describe("仲裁动作 JSON 字符串，例如 '[[\"P\", \"旧名\", \"新名\"], [\"主角\", \"inherit\"]]'"),
    },
    async ({ actions }) => {
      try {
        const root = requireProjectRoot()
        const result = await resolveProjectHistory(root, actions)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `resolve_conflicts 失败: ${error?.message || String(error)}` }],
        }
      }
    },
  )

  // 9. run_logic (逻辑步进与一致性验证)
  server.tool(
    'run_logic',
    '根据已保存的 Markdown 重新生成 AST 语法树，验证逻辑一致性并检测历史资产冲突。',
    {},
    async () => {
      try {
        const root = requireProjectRoot()
        const result = await runMarkdownLogic(root)
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `run_logic 失败: ${error?.message || String(error)}` }],
        }
      }
    },
  )

  server.tool(
    'list_agent_documents',
    '按需列出当前 Agent 分组 details/references 中的辅助文档标题、说明和相对路径，不加载正文。',
    {},
    async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({ documents: await catalogAgentDocuments(process.cwd()) }, null, 2),
      }],
    }),
  )

  server.tool(
    'list_generation_models',
    '按需返回 GraphVideo 内置生成模型的说明、媒体类型、参数 schema 与默认值。模型详情只在调用本工具时进入上下文。',
    {
      mediaType: z.enum(['image', 'video', 'audio']).optional().describe('可选媒体类型过滤'),
      modelId: z.string().optional().describe('可选模型 ID；提供时只返回该模型'),
    },
    async ({ mediaType, modelId }) => {
      const catalog = await generationModelCatalog()
      const models = catalog.models.filter((entry) => (
        (!mediaType || entry.mediaType === mediaType) && (!modelId || entry.id === modelId)
      ))
      return { content: [{ type: 'text', text: JSON.stringify({ models, issues: catalog.issues }, null, 2) }] }
    },
  )

  server.tool(
    'resolve_generation_prompt',
    '只读解析模型 YAML、参数默认值和提示词别名；不执行生成，不直连 generation-adapter。',
    {
      nodeType: z.enum(['image', 'video', 'audio']),
      prompt: z.string(),
      references: z.array(z.object({
        id: z.string(),
        type: z.enum(['image', 'video', 'audio', 'text', 'style']),
        title: z.string().optional(),
        content: z.string().optional(),
        isReady: z.boolean().optional(),
      })).default([]),
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await resolveGenerationPrompt(generationModelsRoot(), input), null, 2) }] }
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: `resolve_generation_prompt 失败: ${error?.message || String(error)}` }] }
      }
    },
  )

  // 10. 注册只读资源 (Resource)
  server.resource(
    'project-overview',
    'project://overview',
    async () => {
      try {
        const root = requireProjectRoot()
        const overview = await getProjectOverview(root)
        return {
          contents: [
            {
              uri: 'project://overview',
              mimeType: 'application/json',
              text: JSON.stringify(overview, null, 2),
            },
          ],
        }
      } catch (error) {
        return {
          contents: [
            {
              uri: 'project://overview',
              mimeType: 'text/plain',
              text: `Error: ${error?.message || String(error)}`,
            },
          ],
        }
      }
    },
  )

  server.resource(
    'generation-model-index',
    'graphvideo://generation-models',
    async () => {
      const catalog = await generationModelCatalog()
      return {
        contents: [{
          uri: 'graphvideo://generation-models',
          mimeType: 'application/json',
          text: JSON.stringify(catalog.models.map(({ id, name, mediaType, description }) => ({ id, name, mediaType, description })), null, 2),
        }],
      }
    },
  )

  return server
}

function setupLifecycle(server) {
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[MCP SERVER FATAL] Uncaught Exception: ${err?.stack || err}\n`)
  })

  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[MCP SERVER ERROR] Unhandled Rejection: ${reason?.stack || reason}\n`)
  })

  const cleanup = async (signal) => {
    process.stderr.write(`[MCP SERVER] Received ${signal}. Shutting down cleanly...\n`)
    try {
      await server.close()
    } catch (error) {
      process.stderr.write(`[MCP SERVER] Error during close: ${error?.message || error}\n`)
    }
    process.exit(0)
  }

  process.on('SIGINT', () => cleanup('SIGINT'))
  process.on('SIGTERM', () => cleanup('SIGTERM'))
}

export async function startMcpServer(projectRoot) {
  const server = createGraphVideoMcpServer(projectRoot)
  setupLifecycle(server)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[MCP SERVER] GraphVideo MCP Server successfully connected on stdio transport.\n')
  return server
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startMcpServer().catch((error) => {
    process.stderr.write(`[MCP SERVER STARTUP ERROR] ${error?.stack || error}\n`)
    process.exit(1)
  })
}
