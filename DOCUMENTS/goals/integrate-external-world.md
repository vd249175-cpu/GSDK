---
type: Developer Guide
title: 接入文件、网络、设备或外部任务
description: 遵循纯领域节点零 I/O 规则，通过物理隔离的 ExecutionWorldNode 与 ObservationWorldNode 以及注入的 EffectAdapter 接入外部世界。
status: stable
tags: [external-world, io, adapter, worldnode, execution, observation]
---

# 接入文件、网络、设备或外部任务

在 GraphFramework 中，**纯领域 Node 必须保持零 I/O、零系统 API**。当业务需要读写文件、发送 HTTP 请求、访问数据库、调用系统进程或监听硬件设备时，必须通过专用的 WorldNode 和构造注入的 `EffectAdapter` 完成。

## 物理隔离铁律：观察与执行物理分离

WorldNode 严格分为两类，观察和执行必须物理分离，不得混合在同一个节点中：

| 节点类型 | 职责与行为 | 约束与禁止项 | 结果如何回到业务 |
| :--- | :--- | :--- | :--- |
| **执行类（`ExecutionWorldNode`）** | 主动向物理系统下发动作、修改外部状态、提交异步任务并获取 handle。执行完成立即结算当前 change。 | **零持续监听职责**，不兼任轮询，不维护长期长连接。 | 将执行结果或任务 handle 封装为 Info，发给业务 Owner Node。 |
| **观察类（`ObservationWorldNode`）** | 监听物理世界事件、轮询任务状态或接收系统回调，将感知到的物理事实作为 Observation 封装为 Info。 | **零主动外部写操作**，不直接发起业务写动作。 | 将观察到的物理事实封装为 Info，发给业务 Owner Node。 |

---

## 架构因果链路

```text
[业务 Node]
   │
   │ 1. ctx.send(ExecuteTaskInfo, executionNodeId)
   ▼
[ExecutionWorldNode] ──2. adapter.perform()──► [外部物理系统]
   │                                                 │
   │ 3. ctx.send(TaskSubmittedInfo, businessNodeId)   │ (异步任务执行)
   ▼                                                 ▼
[ObservationWorldNode] ◄──4. adapter.poll()─────────┘
   │
   │ 5. ctx.send(TaskCompletedInfo, businessNodeId)
   ▼
[业务 Node (State Owner)] ──6. ctx.patchState(...)
```

---

## 步骤 1：定义 EffectAdapter 接口与真实实现

物理动作只通过构造注入的 `EffectAdapter` 执行。Adapter 必须纯粹，只接收和返回 DTO，不包含 GraphFramework 内核上下文。

### Adapter 的两种外部能力来源

根据底层能力的成熟度，Adapter 桥接以下两种来源：
1. **直接第三方标准包**：如 `playwright`、`numpy`，在宿主或包内通过 `import` 直接调用；
2. **二次开发能力包（`packages/<name>`）**：如微软开源的 Windows GUI 智能体 [UFO](https://github.com/microsoft/ufo)（放置在 `packages/ufo/` 中，零 GraphFramework 业务语义），Adapter 作为桥梁调用其暴露的纯 API。

```js
// adapters/ufo-agent.adapter.mjs
// 桥接 packages/ufo 中的底层二次开发能力
import { UfoClient } from '../../../../packages/ufo/client.mjs'

export class UfoActionAdapter {
  constructor(endpoint) {
    this.client = new UfoClient(endpoint)
  }

  async executeGuiAction(actionName, params) {
    // 纯物理 I/O 调用，返回纯 DTO
    const result = await this.client.sendAction(actionName, params)
    return { success: result.ok, snapshotUrl: result.screenshot }
  }
}
```


---

## 步骤 2：编写 ExecutionWorldNode

执行类节点接收来自业务节点的命令，调用注入的 Adapter，并将执行结果作为 Info 发回业务节点：

```js
import { ExecutionWorldNode } from '@graphframework/sdk/plugin'

export class FileExportExecutionNode extends ExecutionWorldNode {
  constructor(id, adapter, businessTargetId) {
    super(id, 'File Export Execution Node')
    this.adapter = adapter
    this.businessTargetId = businessTargetId
  }

  async change(info, ctx) {
    if (info.type === 'RequestExport') {
      try {
        const result = await this.adapter.saveFile(info.fileName, info.content)
        // 成功：将物理事实发送给业务 Owner
        ctx.send(
          {
            type: 'ExportSucceeded',
            exportId: info.exportId,
            path: result.path,
          },
          this.businessTargetId,
        )
      } catch (error) {
        // 失败：异常安全捕获并封装为因果 Info
        ctx.send(
          {
            type: 'ExportFailed',
            exportId: info.exportId,
            error: error.message,
          },
          this.businessTargetId,
        )
      }
    }
  }
}
```

---

## 步骤 3：编写 ObservationWorldNode

若需要轮询任务状态或监听文件变化，由专用的观察类节点承担：

```js
import { ObservationWorldNode } from '@graphframework/sdk/plugin'

export class FileWatcherObservationNode extends ObservationWorldNode {
  constructor(id, adapter, businessTargetId) {
    super(id, 'File Watcher Observation Node')
    this.adapter = adapter
    this.businessTargetId = businessTargetId
  }

  // 由外部观察源或定时轮询驱动
  onExternalEvent(fileChangedEvent, ctx) {
    ctx.send(
      {
        type: 'FileModifiedObservation',
        fileName: fileChangedEvent.fileName,
        timestamp: Date.now(),
      },
      this.businessTargetId,
    )
  }
}
```

---

## 步骤 4：编写测试并注入 Mock/Fake Adapter

在单元测试中，绝不调用真实的外部网络或文件系统。利用依赖注入替换为 Mock/Fake Adapter，覆盖成功、失败、超时与取消场景：

```js
import { describe, expect, it } from 'vitest'
import { createTestRuntime } from '@graphframework/sdk/testing'
import { FileExportExecutionNode } from '../index.mjs'

describe('FileExportExecutionNode', () => {
  it('导出成功时应向业务节点发送 ExportSucceeded', async () => {
    // 构造 Fake Adapter
    const fakeAdapter = {
      saveFile: async (fileName, content) => ({
        path: `/fake/path/${fileName}`,
        size: content.length,
      }),
    }

    const node = new FileExportExecutionNode('export.exec', fakeAdapter, 'todo.items')
    const runtime = createTestRuntime({ nodes: [node] })

    runtime.inject({
      targetNodeId: 'export.exec',
      info: {
        type: 'RequestExport',
        exportId: 'exp-1',
        fileName: 'report.txt',
        content: 'Hello World',
      },
    })
    await runtime.waitForQuiescence()

    // 验证发出的因果 Info
    const sentInfos = runtime.getSentInfos('todo.items')
    expect(sentInfos).toContainEqual(
      expect.objectContaining({
        type: 'ExportSucceeded',
        exportId: 'exp-1',
        path: '/fake/path/report.txt',
      }),
    )
    runtime.dispose()
  })

  it('I/O 抛错时应安全捕获并发送 ExportFailed', async () => {
    const errorAdapter = {
      saveFile: async () => {
        throw new Error('Disk full')
      },
    }

    const node = new FileExportExecutionNode('export.exec', errorAdapter, 'todo.items')
    const runtime = createTestRuntime({ nodes: [node] })

    runtime.inject({
      targetNodeId: 'export.exec',
      info: {
        type: 'RequestExport',
        exportId: 'exp-2',
        fileName: 'fail.txt',
        content: '',
      },
    })
    await runtime.waitForQuiescence()

    const sentInfos = runtime.getSentInfos('todo.items')
    expect(sentInfos).toContainEqual(
      expect.objectContaining({
        type: 'ExportFailed',
        exportId: 'exp-2',
        error: 'Disk full',
      }),
    )
    runtime.dispose()
  })
})
```

> [!NOTE]
> 真实 Adapter 测试样例可参考 `app/plugins/backend/hello-counter/backend.test.mjs`。

---

## 准入与红线检查清单

- [ ] 领域业务 Node 零文件、网络、进程或硬件调用；
- [ ] 执行类节点（`ExecutionWorldNode`）只下发动作，不进行长期轮询；
- [ ] 观察类节点（`ObservationWorldNode`）只感知事实，不主动发起外部写入；
- [ ] 物理能力只通过构造注入的 `EffectAdapter` 执行；
- [ ] 单元测试使用 Fake/Mock Adapter，不访问生产物理资源。

---

## 下一步

- 为功能补充桌面交互界面：[增加桌面界面](build-ui.md)
- 运行和验证当前改动：[为改动补测试并提交](verify-change.md)
- 查阅完整开发准入约束：[开发准入约束与架构红线](../architecture/development-constraints.md)
