---
type: Developer Guide
title: 工作流开发模式操作指南 (workflow-development-mode.md)
description: 业务流程、自动化策略与插件开发指南：沙箱物理隔离、非核心插件不入 app/ 铁律与端到端业务开发流程。
status: stable
tags: [workflow-development, runs, plugins, isolation, sandbox, business-feature]
---

# 工作流开发模式操作指南 (`workflow-development-mode.md`)

本指南适用于在 [`runs/*`](file:///c:/Users/kp157/Desktop/PM/GVSDK/runs) 下从事具体业务流程、自动化录制策略、跨系统集成或 Agent 智能体节点开发的开发者。

在工作流开发模式下，你的代码应当追求**“配置化装配、沙箱完全隔离、快速验证上线”**。

> [!IMPORTANT]
> **面向非技术小白用户的深度工作流开发专栏已建立**：
> 详见 👉 **[工作流开发全景指南 (REFERENCE/workflow/README.md)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/workflow/README.md)**  
> 涵盖：
> 1. **不盲从录制原则**与 **Agent 原生程度五级金字塔**（$\text{API} > \text{MCP} > \text{浏览器} > \text{桌面应用} > \text{像素模仿}$）；
> 2. **主动检索与手把手带教配置 API/MCP**（搜索“XXX开放平台”，用浏览器/桌面工具带用户完成配置，恪守凭据安全红线）；
> 3. **从用户屏幕录制到健壮工作流的“升维提纯”法则**。

---


## 1. 核心工作流心智模型 (Workflow Mental Model)

1. **装配优先于编码 (Assembly over Coding)**：
   - 绝大多数能力（进程管理、窗口控制、文件操作、微内核调度）在平台底座中已开箱即用；
   - 业务开发的主要工作是**编排与装配**：定义业务状态机，用标准 `ctx.send` 串联事件流。
2. **纯数据进出（Data-in, Data-out）**：
   - 业务系统的输入是一条条格式确定的 JSON Info 脉冲；
   - 业务系统的输出是只读的投影数据（Projection）或物理观察（Observation）；
   - 前端组件只负责展示投影，绝不包含核心业务规则。
3. **隔离开发与渐进并入**：
   - 每个开发者或 Agent 独占自己的 run 目录（如 `runs/alice/`、`runs/os-recorder/`）；
   - 所有运行时日志、缓存和构建产物完全被圈禁在 `.generated/` 临时沙箱中。

---

## 2. 必须遵守的隔离铁律

> [!CAUTION]
> **非核心插件不进入 `app/` 铁律**：
> - `app/` 与 `app/plugins/` 仅承载全仓最核心的底座；
> - **所有业务流程、自动化策略、工作流专用节点绝对不进入 `app/`**，必须保持在 `runs/<name>/plugins/` 内隔离开发；
> - **先在独立 run 中跑通单测与集成测试**。验证无误后，如需作为全局生产能力分享，可通过 `runs/main/plugins/` 并入主 run，但**永不进入 `app/`**。

---

## 3. 端到端业务开发标准 5 步法

### 步骤 1：创建独占的开发 Run
以现有模板为基础，建立独立的开发目录：
```text
runs/my-feature/
├── run.config.json          # 运行配置清单
├── assembly.mjs             # 插件与依赖动态装配脚本
└── plugins/
    └── backend/
        └── my-feature/      # 业务逻辑插件目录
            ├── graphframework.plugin.json
            ├── index.mjs
            └── tests/
```

### 步骤 2：声明插件清单 (`graphframework.plugin.json`)
```json
{
  "$schema": "https://graphframework.org/schemas/v2/plugin.manifest.json",
  "id": "my-org.my-feature",
  "name": "My Business Feature",
  "version": "1.0.0",
  "apiVersion": 2,
  "backend": {
    "entry": "./index.mjs"
  }
}
```

### 步骤 3：编写业务节点（纯领域 + 物理拆分）
遵循物理执行与观察严格分离原则：

```ts
import { Node, ExecutionWorldNode } from '@graphframework/sdk/node';

// 1. 纯业务逻辑节点（零 I/O）
export class OrderProcessorNode extends Node<{ status: string }> {
  constructor() {
    super('node-order', 'OrderProcessor', { status: 'idle' });
  }

  protected override change(info, ctx) {
    if (info.type === 'SubmitOrder') {
      ctx.write('status', 'processing');
      // 向物理下发节点发送动作脉冲
      ctx.send({ type: 'ExecutePayment', amount: info.amount }, 'node-payment-exec');
    }
  }
}

// 2. 物理动作下发节点（执行类 WorldNode，执行完立即结算）
export class PaymentExecutionNode extends ExecutionWorldNode<{ lastTradeNo: string }> {
  constructor(private readonly payAdapter) {
    super('node-payment-exec', 'PaymentExecution', { lastTradeNo: '' });
  }

  protected override async change(info, ctx) {
    if (info.type === 'ExecutePayment') {
      const res = await ctx.effectAdapter(this.payAdapter, { amount: info.amount });
      ctx.write('lastTradeNo', res.tradeNo);
    }
  }
}
```

### 步骤 4：编写纯内存单元测试（几毫秒内极速反馈）
在 `tests/` 下建立单测，无需拉起 Electron：
```ts
import { createTestRuntime } from '@graphframework/sdk/testing';

const runtime = createTestRuntime({ nodes: [new OrderProcessorNode()] });
await runtime.inject('node-order', { type: 'SubmitOrder', amount: 100 });
await runtime.waitForQuiescence();
expect(runtime.getState('node-order')?.status).toBe('processing');
await runtime.dispose();
```

### 步骤 5：启动运行与排障
在终端执行统一启动命令：
```bash
# 启动
bash ./run.sh start runs/my-feature/run.config.json

# 查看状态
bash ./run.sh status runs/my-feature/run.config.json

# 遇到因果链不推进时，直接运行内置拓扑体检分析
bash ./run.sh analyze runs/my-feature/run.config.json

# 停止
bash ./run.sh stop runs/my-feature/run.config.json
```

---

## 4. 必读指引与防踏雷手册

- [核心开发模式与底层规范](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/core-development-mode.md)
- [Agent 技能与 MCP 工具箱全景规范 (Playwright / Aliyun Workbench / UFO)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/workflow/skills-and-mcp-tooling.md)
- [JavaScript / TypeScript SDK 全量接口指南](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/sdk/javascript/README.md)
- [机器契约与 23 项操作全集](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/contract/README.md)
- [统一运行管理器 CLI 指南](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/tooling/run.md)
