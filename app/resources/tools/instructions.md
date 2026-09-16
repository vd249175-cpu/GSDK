# GraphVideo MCP 操作规范与路由指南 (Operational Guide)

## 1. 核心交互原则

1. **优先使用原生 MCP 工具**：当需要写入多行口述、剧本、Prompt、查询大纲或结构时，**优先直接调用 MCP 工具**（如 `edit_node`、`get_structure`、`query_nodes`、`batch_edit`），无需拼接 Shell 命令行字符串，保证 100% 零转义损失。
2. **上下文安全视口协议**：
   - 默认使用 `get_structure`（默认深度 `depth: 1`）浏览分支结构；
   - 仅对已锁定的具体节点调用 `query_nodes` 读取长字段（`d`, `c`, `p`）。
3. **内容无损写入**：
   - 编写多行导演口述、场景描述或 YAML 提示词时，调用 `edit_node` 传入原生多行字符串，自动落盘并同步底层 SQLite 与 Markdown。

---

## 2. 常用工具路由对照表

| 任务场景 | 推荐 MCP 工具 | 传统 CLI 备用通道 |
| :--- | :--- | :--- |
| **编辑单节点口述/剧本/Prompt** | `edit_node` | `graphvideo edit <selector> [d/p/c] ...` |
| **批量修改多个节点** | `batch_edit` | `graphvideo edit-file <updates.json>` |
| **查看项目大纲结构** | `get_structure` | `graphvideo structure [scope] [depth]` |
| **精确查询节点属性** | `query_nodes` | `graphvideo query '<selector> :: <fields>'` |
| **全量重写大纲 Markdown** | `write_markdown` | `graphvideo write <text/file>` |
| **局部精确字符串替换** | `replace_node_field` | `graphvideo replace <selector> <field> <target> <rep>` |
| **全局级联重命名实体** | `rename_entity` | `graphvideo rename <old> <new>` |
| **一键仲裁历史命名冲突** | `resolve_conflicts` | `graphvideo structure resolve <actions>` |
| **验证逻辑一致性与 AST** | `run_logic` | `graphvideo run` |
| **索引当前 Agent 辅助文档** | `list_agent_documents` | 无 |
| **查询生成模型契约** | `list_generation_models` | 无 |
| **只读解析模型 Prompt** | `resolve_generation_prompt` | 无 |

模型说明与辅助文档正文按需进入上下文。MCP 不允许 Agent 绕过 Node 调度直接提交、轮询或下载生成任务。
