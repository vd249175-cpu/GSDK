---
type: Reference Manual
title: 计数器与离线诊断插件 (Hello Counter Plugin)
description: 官方 example.hello-counter 插件的无遗漏参考手册。作为微内核最小规约、defineNodeFactory 单节点定义以及静态拓扑离线自诊断的标准实现。
status: stable
---

# 计数器与离线诊断插件 (Hello Counter Plugin)

插件 ID：`example.hello-counter`  
代码源码路径：[`app/plugins/backend/hello-counter/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/app/plugins/backend/hello-counter)

`example.hello-counter` 是 GraphFramework 体系中的**微内核最小参考规约插件**。它没有复杂的物理外设 I/O，仅包含一个原子级状态所有者 `CounterNode`，用于：
1. **最小单飞因果验证**：作为微内核 mailbox/single-flight/change 机制的最简测试 Oracle；
2. **`defineNodeFactory` 单节点工厂规范**：演示标准节点级插件清单与元数据描述规范；
3. **离线静态因果拓扑与健康度诊断**：配合 `analysis/links.mjs` 进行无运行时静态可达性与因果链条证明。

---

## 1. 架构角色与单飞状态变迁 (Minimal Causal Loop)

```mermaid
flowchart LR
    User["外部 / 宿主 / 测试"] -->|IncrementInfo| Counter["example.counter<br>(CounterNode)"]
    Counter -->|change(IncrementInfo)| State["count += 1<br>(独占修改内部 State)"]
    State -.->|EncodedValue 投影| Projection["只读 Projection 视图"]
```

### 核心不变式遵循
- **状态写排他**：外部仅能发送 `IncrementInfo`，不能直接修改 `count`；
- **状态读只读**：读取必须通过微内核生成的 `EncodedValue` 投影，严禁前端伪造内部状态；
- **无遗留旁路**：本插件不贡献前端 Element 或 Workspace，纯用于后端测试与诊断。

---

## 2. 节点工厂与导出规范 (Node Factory & Plugin Definition)

### 2.1 节点类工厂：`createCounterNode`

导出路径：`import { createCounterNode } from '../../app/plugins/backend/hello-counter/index.mjs'`

- **定义方式**：通过 `@graphframework/sdk/plugin` 的 `defineNodeFactory` 高阶包装：
  ```typescript
  export const createCounterNode = defineNodeFactory((ctx) => {
    const nodeId = typeof ctx?.nodeId === 'string' && ctx.nodeId ? ctx.nodeId : 'example.counter';
    return new CounterNode(nodeId);
  });
  ```
- **描述符元数据 (`createCounterNode.describe()`)**：
  ```javascript
  createCounterNode.describe = () => ({
    kind: 'node',
    localIds: ['counter'],
    requiredBindings: [],
    rendererRoots: [{ localId: 'counter', infoType: 'IncrementInfo' }],
  });
  ```

---

### 2.2 插件清单定义 (`graphframework.plugin.json`)

```json
{
  "id": "example.hello-counter",
  "name": "Hello Counter",
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "backend",
  "contributes": {
    "backend": "index.mjs",
    "nodeFactories": ["createCounterNode"],
    "graphFactories": []
  }
}
```

---

## 3. 节点类与 Info 契约

### 3.1 `CounterNode`

- **类定义**：
  ```javascript
  export class CounterNode extends Node {
    constructor(id = 'example.counter') {
      super(id, 'Counter', { count: 0 });
    }

    change(info, ctx) {
      if (info.type === 'IncrementInfo') {
        ctx.patchState({ count: ctx.read('count') + 1 });
      }
    }
  }
  ```

- **状态模式**：
  ```typescript
  interface CounterState {
    count: number;
  }
  ```

- **接受的 Info 契约**：
  - `IncrementInfo` (`{ type: 'IncrementInfo' }`)：触发计数器原子累加 1。

---

## 4. 离线静态因果诊断命令集 (Offline Diagnostics)

本插件配合 `scripts/diagnose.mjs` 与 `analysis/links.mjs`，能够在**不启动 Electron 桌面窗口、不启动常驻后台守护进程**的情况下，对因果图进行完全确定的静态证明：

```bash
# 1. 全局契约与合法性静态校验
npm --prefix packages/desktop run diagnose -- validate

# 2. 查询节点静态定义与类型
npm --prefix packages/desktop run diagnose -- node example.counter

# 3. 检验针对 IncrementInfo 的因果变迁
npm --prefix packages/desktop run diagnose -- change example.counter::IncrementInfo

# 4. 查询 Info 投递路由
npm --prefix packages/desktop run diagnose -- info IncrementInfo@example.counter

# 5. 追踪 count 状态字段的全部归属者与读写关系
npm --prefix packages/desktop run diagnose -- state example.counter::count

# 6. 查询从状态到变迁的因果拓扑路径
npm --prefix packages/desktop run diagnose -- path state:example.counter::count change:example.counter::IncrementInfo

# 7. 全局因果图健康度评估（死锁、不可达检测）
npm --prefix packages/desktop run diagnose -- health

# 8. 证明可达性
npm --prefix packages/desktop run diagnose -- reach example.counter
```

---

## 5. 推荐装配与实例化方式 (Recommended Assembly)

### 5.1 工作流声明式装配 (`runs/<name>/assembly.mjs`)

通过 `run.node` 单独装配节点工厂：

```javascript
// runs/<name>/assembly.mjs
export default {
  id: 'counter.assembly',
  contribute(run) {
    // 1. 注册后端插件
    run.backendPlugin({
      id: 'example.hello-counter',
      path: '../../app/plugins/backend/hello-counter',
    });

    // 2. 装配单个节点实例
    run.node({
      id: 'app-counter',
      plugin: 'example.hello-counter',
      factory: 'createCounterNode',
    });

    // 3. 标记为必须初始化的守护节点
    run.requireNode('app-counter');
  },
};
```

### 5.2 单元测试中极速验证

```javascript
import { createTestRuntime } from '@graphframework/sdk/testing';
import { CounterNode } from '../../app/plugins/backend/hello-counter/index.mjs';

const runtime = createTestRuntime({ nodes: [new CounterNode('test.counter')] });

// 初始状态
console.log(runtime.getState('test.counter')); // { count: 0 }

// 发送 3 次自增并等待结算
runtime.inject({ targetNodeId: 'test.counter', info: { type: 'IncrementInfo' } });
runtime.inject({ targetNodeId: 'test.counter', info: { type: 'IncrementInfo' } });
runtime.inject({ targetNodeId: 'test.counter', info: { type: 'IncrementInfo' } });
await runtime.waitForQuiescence();

// 最终状态
console.log(runtime.getState('test.counter')); // { count: 3 }
runtime.dispose();
```

### 5.3 自动化测试执行

```bash
npm --prefix packages/desktop test -- app/plugins/backend/hello-counter/backend.test.mjs --silent
npm --prefix packages/desktop test -- app/plugins/backend/hello-counter/tests/native-graph-host.test.mjs --silent
```
