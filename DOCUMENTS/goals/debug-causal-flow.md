---
type: Playbook
title: 排查因果链不推进
description: 沿 Info → change → State → send/effect → Projection 链路定位断点，并根据常见业务现象快速排障。
status: stable
tags: [debug, diagnostics, causal-chain, troubleshooting, breakpoint]
---

# 排查因果链不推进

在 GraphFramework 中，一切业务行为都是显式因果流转。当遇到“点击无反应”、“状态不更新”或“下游未收到消息”等问题时，严禁使用盲目加日志或随意改代码的方式排查。遵循标准四步排障流程，可快速定位断点。

---

## 标准四步排障流程

```text
1. 确认三要素 ──► 2. 沿因果链定位断点 ──► 3. 编写针对性测试复现 ──► 4. 固化修复与类型验证
```

### 1. 确认三要素
- **目标 Node ID**：当前执行发生在哪一个具体的 Node 上？
- **State Owner**：这部分业务数据唯一的拥有者是谁？
- **物理隔离边界**：该操作是否涉及外部 I/O？是否通过对应的 WorldNode 与 Adapter 进行？

### 2. 沿因果链路精确定位断点
检查因果推进在哪一步被中断：

```text
Info 收到？
  │── 否 ──► 检查上一节点 ctx.send 目标与 Info.type 是否匹配
  ▼
change 进入对应分支？
  │── 否 ──► 检查 info.type 分支条件与 payload 字段
  ▼
State 成功写入？
  │── 否 ──► 检查 ctx.write / ctx.patchState 是否在当前 Node 内执行
  ▼
send / effect 正确触发？
  │── 否 ──► 检查 Adapter 返回值或下游节点是否在当前 run 中装配
  ▼
Projection 成功推送到前端？
  │── 否 ──► 检查前端 useProjection 是否解码并订阅了对应 node ID
```

### 3. 使用 `createTestRuntime` 验证收敛
使用测试运行时直接复现问题，不依赖外部进程：

```javascript
const runtime = createTestRuntime({ nodes: [...] })
runtime.inject({ targetNodeId: '...', info: { type: '...' } })
await runtime.waitForQuiescence() // 等待因果流转收敛
```

### 4. 固化为针对性单测
修复代码后，保留该复现单测，并通过 `typecheck` 验证。

---

## 常见现象与速查表

| 现象 | 优先检查项 | 典型原因与修复方案 |
| :--- | :--- | :--- |
| **State 没变化** | 1. Info 目标 ID<br>2. `type` 分支<br>3. State 所有权 | - Info 发送到了错误的 Node ID；<br>- `change` 中 `if (info.type === ...)` 未匹配；<br>- 试图跨节点直接写入其他 Node 的 State（被内核拦截）。 |
| **下一个 Node 没收到** | 1. `ctx.send` 的目标 ID<br>2. `Info.type` 字面量<br>3. 目标节点是否装配 | - `ctx.send` 目标写错；<br>- `Info.type` 隐藏在动态变量中导致校验失败；<br>- 目标节点在 `assembly.mjs` 中未声明准入。 |
| **前端按钮被拒绝 / 报错** | 1. `rendererRoots`<br>2. `validate` 校验逻辑 | - 对应命令未在工厂 `describe()` 或插件 `rendererRoots` 中声明；<br>- 前端发送的 payload 未通过 `validate` 校验。 |
| **run 启动前报错失败** | 1. 插件 Manifest<br>2. 工厂名与路径<br>3. `assembly.mjs` | - `graphframework.plugin.json` 中配置的工厂名称与代码导出不一致；<br>- 依赖的插件相对路径解析错误。 |
| **run 已启动但业务未初始化** | 1. `lifecycle.startInfos`<br>2. 初始化结算日志 | - `run.config.json` 中未配置初始触发命令；<br>- 查看 `.generated/runtime/logs/` 中的初始化 Info 结算状态。 |
| **外部调用难以测试** | 1. Adapter 抽象<br>2. Fake Adapter 注入 | - 业务逻辑与物理 I/O 耦合；将 I/O 抽离至 `EffectAdapter`，并在测试中注入 Fake 实现。 |
| **前端显示旧数据** | 1. Projection 订阅<br>2. 解码与版本同步 | - 前端组件缓存了旧数据；确保使用 `useProjection` 监听并由 `valueCodec.decode` 解码。 |

---

## 下一步

- 查阅更详细的实例因果分析工具与技能：[Node 实例因果调试](../diagnostics/debug-guide.md)
- 查看图拓扑分析与全景查询模型：[实例因果分析](../diagnostics/causal-analysis.md)
- 运行针对性测试验证修复：[为改动补测试并提交](verify-change.md)
