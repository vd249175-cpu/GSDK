---
type: API Reference
title: Python SDK 公开接口
description: Python 七个能力面、KernelDaemonClient、Node worker、Effect provider 与测试接口的源码对齐参考。
status: stable
tags: [sdk, python, public-api, worker, daemon-client]
---

# Python SDK 公开接口

开始开发、完整 worker 示例与验收命令见 [SDK 开发入口](../README.md)。Python SDK 是 Rust daemon 的语言镜像，不在 Python 内复制调度内核。

## 1. 公开导入约定

```python
from graphframework_sdk import agent, analysis, effect, node, plugin, protocol, testing
from graphframework_sdk.agent import KernelDaemonClient
```

七个能力面与 JavaScript 子路径同名。`daemon.py` 是传输实现；应用从 `graphframework_sdk.agent` 导入 `KernelDaemonClient`，不依赖实现文件路径。各能力面的公开成员由其 `__init__.py` 汇总。

## 2. KernelDaemonClient

`await KernelDaemonClient.connect(address, token, timeout_s=5.0)` 创建单连接 JSON Lines 客户端；token 至少 16 字节，且只能来自当前 run 的安全配置。

| 方法 | 作用 |
| :--- | :--- |
| `request(op, payload=None)` | 底层请求；自动附加协议版本、递增 id 与 token |
| `health()` | daemon 健康检查 |
| `admit(node_id, initial_state, analysis_facts=None, effect_capabilities=None)` | 准入节点 |
| `evict(node_id)` | 注销并发生破坏性断代 |
| `replace(node_id, initial_state, analysis_facts=None)` | 替换 generation，不继承旧状态或 backlog |
| `inject(target_node_id, info, submission_id)` | 注入根 Info |
| `claim(node_ids)` / `release(node_ids)` | 认领/释放 worker 节点集合 |
| `poll(wait_ms=0)` | 拉取一个 change |
| `commit(change_id, operations, error=None)` | 原子提交有序 write/patch/send 操作或错误 |
| `cancel(submission_id)` | 取消 submission |
| `intervene(node_id, patch, expected_generation, expected_version)` | 带版本守卫的控制面修改 |
| `projection()` | 读取投影 |
| `analyze(request)` / `set_analysis_context(...)` | 调用 Rust 分析并设置图外链接上下文 |
| `agent_inspect(...)` / `agent_inject(...)` / `agent_intervene_state(...)` | 带 Agent 审计字段的控制面操作 |
| `claim_effects(adapter_ids)` / `poll_effect(wait_ms=0)` | 认领与拉取外派 Effect |
| `request_effect(...)` / `await_effect(...)` / `complete_effect(...)` | Effect 请求、等待与结算 |
| `close()` | 关闭 writer；调用方负责在 `finally` 中执行 |

## 3. Node 能力面

- `Info`：`dict[str, Any]` 类型别名。
- `DaemonNodeHandler`：`(info, ctx) -> Awaitable[None] | None`。
- `DaemonNodeChangeContext(snapshot, client, change_id)`：本地积累一次 change 的操作。
- `run_daemon_node_worker(client, handlers, long_poll_ms=1000, stop=None)`：按排序后的 Node ID 认领、轮询、执行并提交；异常作为 error 结算，不击穿 worker 循环。

`DaemonNodeChangeContext` 公开方法：`read(key)`、`write(key, value)`、`patch_state(patch)`、`send(info, target_node_id)`、`await effect(adapter_id, request)`。操作按调用顺序进入一次 `commit`。

## 4. Effect、分析、Agent 与插件

| 能力面 | 公开成员 |
| :--- | :--- |
| effect | `DaemonEffectContext`、`DaemonEffectAdapter`、`run_daemon_effect_provider` |
| analysis | `ANALYSIS_OPS`、`portable_snapshot`、`analyze` |
| agent | `KernelDaemonClient`、`inspect`、`analyze`、`inject`、`intervene_state` |
| plugin | `PluginContributes`、`StudioPluginManifest`、`parse_studio_plugin_manifest`、`define_studio_plugin_manifest` |
| protocol | 协议/尺寸常量、`Info` DTO、`ProtocolError`、`KernelError` |
| testing | `FakeDaemonClient`、`local_change_context`、`wait_for` |

Effect provider 只执行明确认领的 adapter；adapter 失败必须通过 `complete_effect(..., ok=False, error=...)` 结算。业务 worker 不应绕过 `ctx.effect(...)` 直接执行 I/O。

## 5. 验收

```bash
PYTHONPATH=packages/sdk/python/src python -m pytest packages/sdk/python/tests/test_mirror.py
```

该命令验证纯接口与 worker 行为，不要求 daemon。需要跨进程集成时再运行 `test_daemon.py`；它要求当前平台已有可启动的 daemon 构建。跨语言字段或 operation 变化还必须同步 `packages/contract` 并运行 JavaScript SDK 的 typecheck/test。任何示例都不得硬编码真实 token。
