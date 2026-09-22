---
type: Developer Guide
title: GraphFramework 多语言 SDK 开发入口
description: 从公开导入、最小 Node、测试、原生装配到 Python daemon worker 的自包含开发指南。
status: stable
tags: [sdk, node, world-node, quick-start, javascript, python, public-api]
---

# GraphFramework 多语言 SDK 开发入口 (`packages/sdk`)

本页是 SDK 开发的起点。读完即可编写 Node、做纯内存测试，并选择 JavaScript 原生装配或 Python daemon worker；无需先阅读 Rust 内核或语言子页。

## 1. 先选能力面，不从源码深层路径导入

JavaScript/TypeScript 与 Python 使用同一组职责边界，各自通过语言惯用的汇总文件公开 API：

| 能力面 | TypeScript | Python | 放什么 |
| :--- | :--- | :--- | :--- |
| protocol | `@graphframework/sdk/protocol` | `graphframework_sdk.protocol` | Info、DTO、版本、错误 |
| node | `@graphframework/sdk/node` | `graphframework_sdk.node` | Node/change、原生空间或 worker |
| effect | `@graphframework/sdk/effect` | `graphframework_sdk.effect` | EffectAdapter 与 provider |
| plugin | `@graphframework/sdk/plugin` | `graphframework_sdk.plugin` | 插件、工厂、Manifest |
| analysis | `@graphframework/sdk/analysis` | `graphframework_sdk.analysis` | 便携事实与分析请求 |
| agent | `@graphframework/sdk/agent` | `graphframework_sdk.agent` | daemon client 与控制面 |
| testing | `@graphframework/sdk/testing` | `graphframework_sdk.testing` | 内存测试工具与 fake |

公开 API 只从上述入口导入。TS 的真实导出由各 `src/<face>/index.ts` 汇总并同步到 `package.json#exports`；Python 由各 `<face>/__init__.py` 汇总。

## 2. TypeScript：最小 Node 与测试

```ts
import { Node, type DomainChangeContext, type Info } from '@graphframework/sdk/node';

interface CounterState { count: number }

class CounterNode extends Node<CounterState> {
  constructor() {
    super('counter', 'Counter', { count: 0 });
  }

  protected override change(info: Info, ctx: DomainChangeContext<CounterState>) {
    if (info.type !== 'IncrementRequested') return;
    const count = ctx.read('count') + 1;
    ctx.write('count', count);
    ctx.send({ type: 'CounterChanged', count }, 'consumer');
  }
}
```

先用冻结的内存规约测试，不启动 Electron、daemon 或真实外设：

```ts
import { createTestRuntime } from '@graphframework/sdk/testing';

const runtime = createTestRuntime({ nodes: [new CounterNode()] });
runtime.inject({ targetNodeId: 'counter', info: { type: 'IncrementRequested' } });
await runtime.waitForQuiescence();
if (runtime.getState('counter')?.count !== 1) throw new Error('unexpected count');
await runtime.dispose();
```

生产装配使用 Rust 原生微内核，不使用 `KernelRuntime`：

```ts
import { NativeRuleSpace, mountDomainNode } from '@graphframework/sdk/node';

const space = new NativeRuleSpace();
mountDomainNode(space, new CounterNode());
const submissionId = space.injectRoot('counter', { type: 'IncrementRequested' });
await space.waitForSubmission(submissionId);
await space.dispose();
```

## 3. WorldNode：执行与观察必须拆开

- `ExecutionWorldNode` 只下发外部动作，并通过构造注入的 `EffectAdapter` 调用 `ctx.effectAdapter(...)`；完成后立即结算，不轮询。
- `ObservationWorldNode` 只监听、轮询或接收回调，把外部事实封装为 Info；不主动写外部系统。
- 纯 `Node` 只能使用 `read / write / patchState / send / span`，不能执行 Effect。

```ts
import {
  ExecutionWorldNode,
  type Info,
  type WorldChangeContext,
} from '@graphframework/sdk/node';
import type { EffectAdapter } from '@graphframework/sdk/effect';

class SaveNode extends ExecutionWorldNode<{ lastHandle?: string }> {
  constructor(private readonly saver: EffectAdapter<{ text: string }, { handle: string }>) {
    super('save', 'Save', {});
  }

  protected override async change(info: Info, ctx: WorldChangeContext<{ lastHandle?: string }>) {
    if (info.type !== 'SaveRequested' || typeof info.text !== 'string') return;
    const result = await ctx.effectAdapter(this.saver, { text: info.text });
    ctx.write('lastHandle', result.handle);
  }
}
```

## 4. Python：连接 daemon 并运行 worker

Python 不复制调度内核；`KernelDaemonClient` 从统一的 `agent` 能力面导入，通过 JSON Lines 使用 Rust daemon：

```python
import asyncio

from graphframework_sdk.agent import KernelDaemonClient
from graphframework_sdk.node import DaemonNodeChangeContext, run_daemon_node_worker


async def increment(info: dict, ctx: DaemonNodeChangeContext) -> None:
    if info.get("type") != "IncrementRequested":
        return
    count = ctx.read("count") + 1
    ctx.write("count", count)
    ctx.send({"type": "CounterChanged", "count": count}, "consumer")


async def main() -> None:
    client = await KernelDaemonClient.connect("127.0.0.1:9099", "replace-with-run-token")
    try:
        await client.admit("counter", {"count": 0})
        await run_daemon_node_worker(client, {"counter": increment})
    finally:
        client.close()


asyncio.run(main())
```

端口和 token 必须来自当前独立 run；不得写入仓库。实际启动 daemon 或桌面应用只能通过根目录 `run.sh`。

## 5. 修改与验收

新增或修改公开 API 时，同一提交必须同步：实现、汇总导出、JS `package.json#exports`/构建 entry（如新增能力面）、README 和导出测试。

```bash
npm --prefix packages/sdk/javascript run typecheck
npm --prefix packages/sdk/javascript test
PYTHONPATH=packages/sdk/python/src python -m pytest packages/sdk/python/tests/test_mirror.py
npm --prefix packages/desktop run typecheck
```

完成标准：示例只使用公开入口；纯 Node 无 I/O；WorldNode 职责拆分；测试不靠真实设备；TS 与 Python 对同一协议字段保持一致。

需要查阅完整成员表时再进入 [JavaScript / TypeScript API](javascript/README.md) 或 [Python API](python/README.md)。
