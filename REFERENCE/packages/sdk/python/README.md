---
type: Developer Guide
title: Python SDK 接入与 Worker 规范 (packages/sdk/python)
description: Python 语言生态接入指南、KernelDaemonClient 客户端与跨语言分布式 Node Worker 实现。
status: stable
tags: [sdk, python, worker, daemon-client, cross-language]
---

# Python SDK 接入与 Worker 规范 (`packages/sdk/python`)

源码目录：[`packages/sdk/python/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/sdk/python)

Python SDK 是 GraphFramework 面向 AI 算法、数据科学与系统控制生态的专用 SDK。它通过标准 JSON Lines 协议与后台常驻守护进程（`kernel-daemon`）通信，实现非 Node.js 环境下的因果节点注册、任务拉取与状态变迁。

---

## 1. 核心接入模式：`KernelDaemonClient`

无需编译 C 扩展，直接通过异步网络连接与 Daemon 建立握手：

```python
import asyncio
from graphframework_sdk.daemon import KernelDaemonClient

async def main():
    # 1. 连接到本地常驻守护进程
    client = await KernelDaemonClient.connect(
        address="127.0.0.1:9099",
        token="0123456789abcdef0123456789abcdef"
    )

    # 2. 检查守护进程健康度
    health = await client.health()
    print("Daemon 状态:", health)

    # 3. 注册 Python 独占节点
    await client.admit(
        node_id="python-ai-processor",
        initial_state={"status": "ready", "processedCount": 0}
    )

    # 4. 认领并开始拉取单飞任务
    await client.claim("python-ai-processor")
    print("Python Node 已成功上线挂载至 Rust 微内核！")

if __name__ == "__main__":
    asyncio.run(main())
```

---

## 2. 核心交互接口清单

| 方法 | 功能描述 |
| :--- | :--- |
| `client.health()` | 获取当前微内核健康度与存活状态 |
| `client.admit(node_id, initial_state)` | 准入一个新节点并设定初始 JSON 状态 |
| `client.claim(node_id)` | 声明本 Python 进程作为该 Node 的独占 Worker |
| `client.poll_change(node_id)` | 拉取待处理的 Change 任务（返回 token 与 view） |
| `client.commit_change(token, patch, sends)` | 执行完毕后原子提交 State Patch 与衍生脉冲 |
| `client.send(sender, target, info_type, payload)` | 从 Python 端向图内任意节点发送脉冲 |
| `client.inject_root(target, info_type, payload, submission)` | 发起根任务提交 |
