---
type: Developer Guide
title: 业务开发入门
description: 不阅读内核实现即可从业务需求完成 Node、插件、测试、run 装配与启动的主路径。
status: stable
tags: [getting-started, application, plugin, run, testing]
---

# 业务开发入门

这是业务开发者的默认入口。开始开发不需要先阅读 Rust 内核、daemon 协议、SDK 包结构或调度实现；那些内容只在维护平台、跨语言接入或排查底层问题时使用。

## 开始前只记住四个词

| 词 | 在业务代码里的含义 | 你要做什么 |
| --- | --- | --- |
| Node | 一类业务事实及其处理规则 | 为持续存在的业务事实选一个唯一负责者 |
| State | 该 Node 当前保存的业务事实 | 只在该 Node 的 `change` 中修改 |
| Info | 一次命令、事件或结果 | 用 `type` 区分，并发送给明确的目标 Node |
| run | 本次要启动的插件、实例和界面组合 | 在 `runs/<name>/` 中选择并启动 |

最常见的处理链只有一行：

```text
收到 Info → 校验业务条件 → 更新自己的 State → 必要时向下一个 Node 发送 Info
```

如果功能需要写文件、访问网络、数据库、系统进程或其它外部服务，再增加专门的物理接入 Node 和可替换 Adapter。普通业务 Node 不直接做这些操作。

## 选择最短开发路径

| 需求 | 从哪里开始 | 完成后看什么 |
| --- | --- | --- |
| 单个业务规则或后台自动化 | `app/plugins/backend/hello-counter/` | 本文 §第一个业务功能 |
| 多步骤业务流程 | `app/plugins/backend/demo-topology/` | 本文 §多个 Node 协作 |
| 带桌面界面的业务功能 | 先完成后端与测试，再参考 `app/plugins/frontend/demo-topology/` | [Client 与 Element SDK](client-sdk-guide.md) |
| 文件、网络、数据库或外部任务 | 先确定业务 State 的 Owner，再增加执行/观察物理节点 | 本文 §接入外部世界 |
| 修改框架、运行宿主或跨语言协议 | 不走本入门路径 | [平台维护者入口](../architecture/) |

## 第一个业务功能

以下结构足够完成一个可测试、可装配、可运行的后台功能：

```text
app/plugins/backend/example-todo/
├─ graphframework.plugin.json
├─ index.mjs
├─ tests/
│  └─ todo.test.mjs
└─ package.json

runs/<your-name>/
├─ assembly.mjs
├─ run.config.json
├─ start.sh / stop.sh / status.sh
└─ start.cmd / stop.cmd / status.cmd
```

可以复制 `app/plugins/backend/hello-counter/` 和 `runs/alice/` 作为起点，再按下面四步替换业务名称与行为。不要从 `packages/rust/`、`packages/sdk/` 或 `packages/desktop/` 复制实现。

### 1. 写业务 Node

`index.mjs`：

```js
import {
  Node,
  defineBackendPlugin,
  defineNodeFactory,
} from '@graphframework/sdk/plugin'

export class TodoNode extends Node {
  constructor(id = 'todo.items') {
    super(id, 'Todo items', { items: [] })
  }

  change(info, ctx) {
    if (info.type === 'AddTodo') {
      ctx.write('items', [
        ...ctx.read('items'),
        { id: info.id, title: info.title, done: false },
      ])
    }

    if (info.type === 'CompleteTodo') {
      ctx.write(
        'items',
        ctx.read('items').map((item) =>
          item.id === info.id ? { ...item, done: true } : item,
        ),
      )
    }
  }
}

export const createTodoNode = defineNodeFactory((ctx) =>
  new TodoNode(ctx?.nodeId ?? 'todo.items'),
)

createTodoNode.describe = () => ({
  kind: 'node',
  localIds: ['todo'],
  requiredBindings: [],
  rendererRoots: [
    { localId: 'todo', infoType: 'AddTodo' },
    { localId: 'todo', infoType: 'CompleteTodo' },
  ],
})

export default defineBackendPlugin({
  id: 'example.todo',
  createNodes: (context) => [createTodoNode(context)],
  rendererRoots: [
    {
      targetNodeId: 'todo.items',
      infoType: 'AddTodo',
      validate: (info) =>
        typeof info?.id === 'string' && typeof info?.title === 'string',
    },
    {
      targetNodeId: 'todo.items',
      infoType: 'CompleteTodo',
      validate: (info) => typeof info?.id === 'string',
    },
  ],
})
```

业务开发时遵守这五条即可：

1. 每份持续存在的业务事实只有一个 Node 负责。
2. 只在当前 Node 的 `change(info, ctx)` 中修改自己的 State。
3. Node 之间只用 `ctx.send({ type: '...' }, targetNodeId)` 协作。
4. `Info.type` 直接写在发送位置，不藏进无法检查的通用消息构造器。
5. `rendererRoots` 只公开用户可以直接发起的命令，并校验输入；内部事件不要公开。

### 2. 声明插件文件

`graphframework.plugin.json`：

```json
{
  "id": "example.todo",
  "name": "Todo",
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "backend",
  "contributes": {
    "backend": "index.mjs",
    "nodeFactories": ["createTodoNode"],
    "graphFactories": []
  }
}
```

`package.json` 可以沿用 `hello-counter` 的形状，只修改包名。仓库内插件测试与构建统一从 `packages/desktop` 运行，不需要为每个示例另造启动器。

### 3. 先写一个局部测试

`tests/todo.test.mjs`：

```js
import { describe, expect, it } from 'vitest'
import { createTestRuntime } from '@graphframework/sdk/testing'
import plugin from '../index.mjs'

describe('todo', () => {
  it('新增待办', async () => {
    const runtime = createTestRuntime({ nodes: plugin.createNodes({}) })

    runtime.inject({
      targetNodeId: 'todo.items',
      info: { type: 'AddTodo', id: '1', title: '写第一个功能' },
    })
    await runtime.waitForQuiescence()

    expect(runtime.getState('todo.items').items).toEqual([
      { id: '1', title: '写第一个功能', done: false },
    ])
    runtime.dispose()
  })
})
```

在仓库根目录执行针对性测试：

```bash
npm --prefix packages/desktop test -- app/plugins/backend/example-todo/tests/todo.test.mjs --silent
```

测试时直接验证业务 State、发出的 Info 和外部调用，不复制一份业务逻辑到测试里。完整命令索引见[测试分层](testing.md)。

### 4. 把功能加入自己的 run

复制 `runs/alice/` 为 `runs/<your-name>/` 后：

- 将 `run.config.json` 的 `name` 改成目录名；
- 将 `assembly.mjs` 改为选择自己的插件与工厂；
- 将 `lifecycle.startInfos` 留空，或填入开发时确实需要的初始业务命令；
- 保留现有 daemon、超时和 `.generated` 资源配置；
- 将便捷脚本中的展示名称一并替换，脚本仍只委托根目录 `run.sh`。

`assembly.mjs`：

```js
export default {
  id: 'example.todo-run',
  contribute(run) {
    run.backendPlugin({
      id: 'example.todo',
      path: '../../app/plugins/backend/example-todo',
    })
    run.node({
      id: 'todo.items',
      plugin: 'example.todo',
      factory: 'createTodoNode',
    })
  },
}
```

先校验配置，再用唯一入口启动：

```bash
node packages/tooling/run/src/cli.mjs validate runs/<your-name>/run.config.json
bash ./run.sh start runs/<your-name>/run.config.json
bash ./run.sh status runs/<your-name>/run.config.json
bash ./run.sh stop runs/<your-name>/run.config.json
```

Windows 也可以直接运行该目录的 `start.cmd`、`status.cmd` 和 `stop.cmd`。不要用 `npm start`、直接启动 Electron 或临时脚本绕过 `run.sh`。

## 多个 Node 协作

当一个 Node 不应该拥有另一份业务事实时，发送 Info 给真正的 Owner：

```js
change(info, ctx) {
  if (info.type === 'OrderAccepted') {
    ctx.patchState({ accepted: ctx.read('accepted') + 1 })
    ctx.send(
      { type: 'ReserveStock', orderId: info.orderId },
      this.targets.inventory,
    )
  }
}
```

判断是否需要拆 Node 时，只问三个问题：

- 这份事实由谁负责？
- 它与当前事实的生命周期是否相同？
- 以后是否需要独立测试、替换或复用？

答案不同就拆开，用 Info 连接。纯计算、格式化和校验只是普通函数，不需要变成 Node。完整多节点示例位于 `app/plugins/backend/demo-topology/index.mjs`。

## 接入外部世界

需要 I/O 时按职责拆成两类，业务 State 仍留在领域 Node：

| 需求 | 放置位置 | 结果如何回到业务 |
| --- | --- | --- |
| 写文件、发请求、提交外部任务 | `ExecutionWorldNode` + 构造注入的 Adapter | 将结果作为 Info 发给业务 Owner |
| 监听文件、轮询状态、接收回调 | `ObservationWorldNode` + 构造注入的 Adapter | 将观察到的事实作为 Info 发给业务 Owner |

同一个物理 Node 不同时负责“发起动作”和“持续观察”。测试中替换 Adapter，覆盖成功、失败、超时与取消；不要真的访问生产服务。最小 Adapter 测试可参考 `app/plugins/backend/hello-counter/backend.test.mjs`。

## 增加界面

推荐顺序是：

1. 先让后端 Node 的测试通过；
2. 在后端 `rendererRoots` 中只公开用户命令；
3. 前端通过宿主提供的命令客户端发送命令；
4. 前端只从 Projection 读取业务事实；
5. 选择项、输入草稿、面板布局等只放在前端临时状态。

完整桌面例子在 `app/plugins/frontend/demo-topology/`，前端订阅与 Element API 见 [Client 与 Element SDK](client-sdk-guide.md)，主题与组件规则见[设计系统](design-system.md)。业务前端不需要创建或持有内核。

## 常见问题按现象处理

| 现象 | 先检查什么 |
| --- | --- |
| State 没变化 | Info 的目标 ID、`type` 分支、State 是否由当前 Node 拥有 |
| 下一个 Node 没收到 | `ctx.send` 的目标 ID、发送点是否直接写出了 `Info.type`、目标是否已装配 |
| 前端按钮被拒绝 | 对应命令是否在工厂描述和插件 `rendererRoots` 中都声明且通过校验 |
| run 启动前失败 | Manifest 中的插件 ID、导出工厂名、assembly 路径和实例 ID |
| run 已启动但功能未初始化 | `lifecycle.initInfos/startInfos` 的目标与 payload，以及日志中的结算结果 |
| 外部调用难以测试 | I/O 是否已经移入 Adapter，测试是否注入了 fake Adapter |
| 前端显示旧数据 | 是否从 Projection 解码读取、订阅 revision，而不是维护第二份业务 State |

仍无法定位时，再使用 [Node 实例因果调试](../diagnostics/debug-guide.md)。只有问题落在调度、宿主、跨语言或发布边界时，才需要阅读 Kernel、协议和 SDK 心智模型。

## 提交前完成定义

- 业务 State 有明确且唯一的 Owner；
- 每个公开 Info 都有输入校验，每个内部 send 的 `type` 在发送点可见；
- 纯领域 Node 没有文件、网络、进程或系统 API；
- 针对性测试覆盖主要成功路径和关键失败路径；
- 自己的 `runs/<name>/` 能通过配置校验，并且只通过 `run.sh` 启停；
- 代码变更通过两套 TypeScript 类型检查；
- 文档与公开契约和实现同步。

验证命令的唯一正本在[测试分层](testing.md)，不要从其它文档复制一套长期维护的命令清单。
