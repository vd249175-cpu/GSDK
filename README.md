# GraphFramework SDK

GraphFramework 用于构建由业务事实和显式事件驱动的桌面与后端应用。业务开发者不需要先理解 Rust 内核或 SDK 内部实现。

## 开始开发

1. 阅读[业务开发入门](DOCUMENTS/guides/application-development.md)，用最小示例完成 Node、插件和测试。
2. 从 `app/plugins/backend/hello-counter/` 复制后台插件起点。
3. 从 `runs/alice/` 复制自己的独立 run，并修改名称与装配。
4. 先运行针对性测试和配置校验，再通过根目录 `run.sh` 启动。

```bash
node packages/tooling/run/src/cli.mjs validate runs/<name>/run.config.json
bash ./run.sh start runs/<name>/run.config.json
bash ./run.sh status runs/<name>/run.config.json
bash ./run.sh stop runs/<name>/run.config.json
```

Windows 用户也可以运行 `runs/<name>/start.cmd`、`status.cmd` 和 `stop.cmd`。不要用 `npm start` 或直接启动 Electron 绕过统一 run。

## 按任务找文档

| 任务 | 文档 |
| --- | --- |
| 新增业务功能或插件 | [业务开发入门](DOCUMENTS/guides/application-development.md) |
| 测试与提交前验证 | [测试分层](DOCUMENTS/guides/testing.md) |
| 新增桌面界面 | [Client 与 Element SDK](DOCUMENTS/guides/client-sdk-guide.md) |
| 排查业务因果链 | [Node 实例因果调试](DOCUMENTS/diagnostics/debug-guide.md) |
| 首次准备开发环境 | [文档导航：首次源码接入](DOCUMENTS/README.md#首次源码接入) |
| 维护内核、宿主或跨语言协议 | [平台架构](DOCUMENTS/architecture/) |

完整知识库入口见 [DOCUMENTS/README.md](DOCUMENTS/README.md)。仓库协作、架构红线与唯一启动方式见 [AGENTS.md](AGENTS.md)。
