# Agent CLI 与 MCP 兼容层

Electron 以 Agent 分组目录作为工作目录，在目录内写入 Anti-Gravity 使用的 `.agents/mcp_config.json`、Claude 使用的 `.mcp.json` 与 OpenCode 使用的 `opencode.json`。Codex 通过本次启动的 `-c mcp_servers.graphvideo.*` 参数注册相同服务，不改写用户级配置。项目路径和数据型模型目录通过环境变量传入，不挂载共享 Skills 目录。

`GRAPHVIDEO_AGENT_CLI` 选择启动器：

| 值 | 项目目录参数 |
| :--- | :--- |
| `agy`（默认） | 无项目目录参数；读取 Agent 分组内 MCP 配置 |
| `codex` | 本次会话 `mcp_servers.graphvideo.*` 覆盖 |
| `claude` | `--mcp-config .mcp.json --strict-mcp-config` |
| `opencode` | 无额外目录参数；从 Agent 分组目录读取 `opencode.json` |

Agent 的角色提示词、导航和辅助文档只存在于自己的分组目录。复制一个完整分组目录即可建立隔离的新 Agent；MCP 工具仍由 Electron 在启动时统一注册。项目目录不作为额外 CLI 工作区挂载，项目读写只经过 MCP。
