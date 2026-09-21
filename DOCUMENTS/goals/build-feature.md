---
type: Developer Guide
title: 开发第一个业务功能
description: 从零编写业务 Node、声明插件、编写局部测试并实现多节点因果协同。
status: stable
tags: [feature, node, plugin, test, backend]
---

# 开发第一个业务功能

本指南面向业务开发者。在 GraphFramework 中，开发业务功能不需要理解 Rust 内核内部实现或底层 daemon 调度机制。遵循因果驱动范式，即可编写出高内聚、易测试的业务功能。

## 开始前只记住四个词

| 词 | 在业务代码里的含义 | 你要做什么 |
| :--- | :--- | :--- |
| **Node** | 一类业务事实及其处理规则 | 为持续存在的业务事实选一个唯一负责者 |
| **State** | 该 Node 当前保存的业务事实 | 只在该 Node 的 `change(info, ctx)` 中修改 |
| **Info** | 一次命令、事件或结果 | 用 `type` 区分，并发送给明确的目标 Node |
| **run** | 本次要启动的插件、实例和界面组合 | 在 `runs/<name>/` 中选择并启动 |

最核心的处理链路只有一行：

```text
收到 Info → 校验业务条件 → 更新自己的 State → 必要时向下一个 Node 发送 Info
```

---

## 开发态隔离规范：开发与测试在 run 内进行

> [!IMPORTANT]
> **非核心插件不进入 `app/`**：
> - `app/` 与 `app/plugins/` 仅承载全仓最核心的底座与核心插件；
> - **非核心插件绝不进入 `app/`，只在 run 下的特定工作流中**；在开发和测试阶段，新插件**必须保持在当前开发者独占的 run 目录下**（例如 `runs/<your-name>/plugins/example-todo/`）；
> - 这样可以避免污染公共核心空间，防止多 Agent 协作时的 Git 索引冲突；
> - 只有当针对性单测通过、run 联调验证成功后，工作流才可通过 `runs/main/plugins/` 并入主 run 或打包为能力包分发，但**绝不进入核心 `app/`**。

---

## 推荐工程结构（开发与测试态）

在你的独立 run 目录（如 `runs/alice/`）下创建开发插件：

```text
runs/<your-name>/
├─ plugins/
│  └─ example-todo/                  # 本 run 独占的开发插件
│     ├─ graphframework.plugin.json  # 插件声明文件
│     ├─ index.mjs                   # 业务 Node 与插件定义
│     ├─ tests/
│     │  └─ todo.test.mjs            # 针对性单元测试
│     └─ package.json                # 基础元数据
├─ assembly.mjs                      # 装配本 run 的开发插件 (./plugins/example-todo)
├─ run.config.json                   # 运行配置
└─ start.sh / stop.sh / status.sh    # 便捷脚本
```

> [!TIP]
> 首次开发建议直接参考 `app/plugins/backend/hello-counter/` 的实现作为起点，将其复制到 `runs/<your-name>/plugins/` 下修改。不要从 `packages/rust/` 或 `packages/desktop/` 复制代码。

---

## 步骤 1：编写业务 Node

在 `runs/<your-name>/plugins/example-todo/index.mjs` 中定义业务 Node 与插件：

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

### 业务开发五项黄金准则

1. **唯一负责者**：每份持续存在的业务事实只有一个 Node 负责。
2. **所有权受限写入**：只能在当前 Node 的 `change(info, ctx)` 中修改自己的 State，外部只能发 Info。
3. **因果通信**：Node 之间仅使用 `ctx.send({ type: '...' }, targetNodeId)` 协作，不存在全局事件总线或共享变量。
4. **静态可证明**：`Info.type` 直接写在发送点，不把 Info 隐藏在不透明构造函数或通用打包器中。
5. **门禁校验**：`rendererRoots` 只公开用户可以直接发起的命令并做强校验；内部事件绝不公开。

---

## 步骤 2：声明插件清单

在 `runs/<your-name>/plugins/example-todo/graphframework.plugin.json` 中配置插件清单：

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

`package.json` 可以沿用 `hello-counter` 的格式，仅修改包名。

---

## 步骤 3：编写针对性局部单测

使用 `@graphframework/sdk/testing` 提供的 `createTestRuntime`，无需启动任何后台进程即可验证收敛行为：

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

### 运行测试

在仓库根目录执行针对性测试（使用 `--silent` 避免冗余日志）：

```bash
npm --prefix packages/desktop test -- runs/<your-name>/plugins/example-todo/tests/todo.test.mjs --silent
```

---

## 步骤 4：多节点因果协作

当功能复杂度增加，一个 Node 不应拥有另一份业务事实时，通过发送 Info 委托给真正的 Owner：

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

### 拆分 Node 的三个判断问题

- **责任归属**：这份事实由谁负责？
- **生命周期**：它与当前事实的生命周期是否相同？
- **演进隔离**：以后是否需要独立测试、替换或复用？

如果答案不同，果断拆为独立 Node，通过显式 Info 连接。多节点完整协作样例请参考 `app/plugins/backend/demo-topology/index.mjs`。

---

## 步骤 5：测试通过后的并入与交付

> [!IMPORTANT]
> **非核心插件不进入 `app/`**：
> 业务开发中的功能插件绝大多数属于非核心插件。非核心插件**绝对不进入 `app/`**，只存在于 run 下的特定工作流中。只有当针对性单测通过、run 联调无误后，才结束 run 内隔离状态，进入以下交付路径：

1. **并入主 run 工作流（`runs/main`）**：
   - 若该工作流属于团队共同使用的正式工作流，在独立 run 中测试完全跑通后，将插件并入主 run 插件目录 `runs/main/plugins/example-todo/`；
   - 在 `runs/main/assembly.mjs` 中通过相对路径引用 `./plugins/example-todo` 装配；
   - 工作流通过 run 下的插件并入，**但绝不进入核心 `app/`**。
2. **打包为能力包独立分发（工作流与业务能力）**：
   - 若作为独立业务能力或实验性流程分享给他人，将插件组织为能力包目录结构并编写 `PACKAGE.md`；
   - 使用 `bash ./run.sh pack` 生成发布 ZIP 与 SHA-256，通过自建服务端协作通道分发（详见 [打包、安装或更新能力](distribute-capability.md)）；
   - 接收方解压到自己 run 目录下装配，同样不进入 `app/`。
3. **（仅限平台核心基础设施）并入核心 `app/plugins/`**：
   - 极少数属于平台级核心基础设施的插件（经架构评审），才作为核心插件并入 `app/plugins/`，随基础软件更新包统一发布。

---

## 下一步

- 将新功能接入独立 run 启动运行：[创建和运行独立 run](run-application.md)
- 如果功能涉及文件、网络或外部任务：[接入外部世界](integrate-external-world.md)
- 如果需要增加桌面界面：[增加桌面界面](build-ui.md)
- 将功能打包分发给团队成员：[打包、安装或更新能力](distribute-capability.md)

