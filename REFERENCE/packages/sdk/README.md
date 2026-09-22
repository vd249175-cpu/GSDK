---
type: Architecture Specification
title: GraphFramework 多语言 SDK 规范 (packages/sdk)
description: 面向业务开发者的多语言 SDK 使用指南：零源码门槛定义业务节点、因果状态管理与即插即用装配。
status: stable
tags: [sdk, node, world-node, quick-start, javascript, python]
---

# GraphFramework 多语言 SDK 规范 (`packages/sdk`)

`packages/sdk` 是面向全语言业务开发者的核心开发套件。

**本指南的目的是：让你无需了解底层 Rust 微内核调度机制，即可用最精炼的代码（JavaScript/TypeScript 或 Python）定义业务节点、管理状态、触发副作用并挂载进系统运行。**

---

## 1. 它是做什么的？（核心能力与价值）

SDK 为你抹平了所有复杂的底层因果协议与内存细节，提供三大开箱即用能力：
1. **纯领域节点（Domain Node）**：10 行代码定义一个自包含的业务状态机，自带原子状态读写与确定性脉冲投递；
2. **物理世界安全接入（World Node & EffectAdapter）**：将网络请求、文件读写、数据库操作物理隔离为“观察（Observation）”与“执行（Execution）”，绝不污染纯因果业务状态；
3. **多语言同权互通**：无论你使用 TypeScript 还是 Python，节点的生命周期、状态机模型与通信报文完全等价，跨语言通信完全透明。

---

## 2. 30 秒上手：最简纯领域节点示例 (TypeScript)

无需繁琐配置，继承基类即可完成一个安全的业务计数器：

```ts
import { Node, type DomainChangeContext, type Info } from '@graphframework/sdk/node';

// 1. 定义状态结构
interface CounterState {
  count: number;
}

// 2. 编写自包含节点
export class CounterNode extends Node<CounterState> {
  constructor(id = 'node-counter') {
    super(id, 'Counter', { count: 0 });
  }

  // 3. 唯一的业务变化入口（Change Handler）
  protected override change(info: Info, ctx: DomainChangeContext<CounterState>) {
    if (info.type === 'IncrementRequested') {
      const nextCount = ctx.read('count') + 1;
      ctx.write('count', nextCount); // 原子写入状态
      
      // 派发因果脉冲至目标节点（返回 enqueued 即代表安全进入目标队列）
      ctx.send({ type: 'CounterChanged', count: nextCount }, 'consumer-node');
    }
  }
}
```

> **开箱即用保障**：该节点的 `count` 状态**只能**在 `change` 中由自己写入；并发调用被底层单飞调度器自动序列化，绝无数据竞争。

---

## 3. 核心节点类型与使用法则

在 GraphFramework 中，节点严格分为三类，职责绝不混淆：

| 节点类型 | 继承基类 | 核心法则 | 典型场景 |
| :--- | :--- | :--- | :--- |
| **纯领域节点** | [`Node<State>`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/sdk/javascript/src/node/node.ts) | **零 I/O、零系统 API**。纯内存计算与状态变迁，百分百可测试、可回溯 | 状态汇总、计算逻辑、路由策略、业务规则校验 |
| **外部执行节点** | [`ExecutionWorldNode<State>`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/sdk/javascript/src/node/node.ts) | **主动写外部、拿 handle 立即结算**。零持续监听职责，不兼任轮询 | 写文件、发网络请求、向外部设备下发动作 |
| **外部观察节点** | [`ObservationWorldNode<State>`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/sdk/javascript/src/node/node.ts) | **只读监听、感知事实转为 Info**。零主动外部写操作 | 文件监听、系统事件感知、定时器脉冲触发 |

---

## 4. 语言子包快速入口

根据你的技术栈选择对应语言 SDK 查阅详细接口与模板：

- **[JavaScript / TypeScript SDK (`javascript/`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/sdk/javascript/README.md)**：包含桌面端宿主（`NativeRuleSpace`）、React 前端快照 Hooks、EffectAdapter 体系与单测 Harness。
- **[Python SDK (`python/`)](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/sdk/python/README.md)**：包含 Python 原生 Node Worker、Daemon 自动重连客户端与独立脚本执行能力。
