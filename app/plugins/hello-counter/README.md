---
type: guide
title: Counter 示例与离线自诊断
---

# Counter 示例与离线自诊断

本插件 ID 为 `example.hello-counter`，创建 `example.counter`。唯一公开用户意图为 `IncrementInfo`，在该 Owner 的单飞 change 中增加 count；读取通过 Projection/EncodedValue，不另造读取 Info。默认 Studio application 没有启用此插件，它用于最小后端测试和离线诊断，不贡献 Element 或 Workspace。

## 自诊断

在仓库根目录运行：

```bash
npm --prefix packages/desktop run diagnose -- validate
npm --prefix packages/desktop run diagnose -- node example.counter
npm --prefix packages/desktop run diagnose -- change example.counter::IncrementInfo
npm --prefix packages/desktop run diagnose -- info IncrementInfo@example.counter
npm --prefix packages/desktop run diagnose -- state example.counter::count
npm --prefix packages/desktop run diagnose -- path state:example.counter::count change:example.counter::IncrementInfo
npm --prefix packages/desktop run diagnose -- select example.counter
npm --prefix packages/desktop run diagnose -- frontend
npm --prefix packages/desktop run diagnose -- health
npm --prefix packages/desktop run diagnose -- reach example.counter
```

`scripts/diagnose.mjs` 使用 `analysis/links.mjs` 显式声明的 counter 入口与投影关系，读取已构造实例，不创建生产 Runtime。`analysis/config.json` 是消费方配置，不会由内核自动读取。诊断结果是静态关系证据，不代表正在运行的 Studio 状态。运行中应用的观测与分析入口见[调试指南](../../../DOCUMENTS/debug-guide.md)。

## 复用与验证

| 复用项 | 公开来源 | Owner / 生命周期 |
| --- | --- | --- |
| Node 与 change Context | `@graphvideo/sdk/node` | 插件定义行为，宿主持有运行 State |
| defineBackendPlugin 与 Manifest 校验 | `@graphvideo/sdk/plugin` | 插件工厂/身份与 rendererRoots |
| NativeRuleSpace、mountDomainNode、replaceDomainNode | `@graphvideo/sdk/node` | 宿主规则空间，按 generation 生命周期 |
| Rust 调度绑定 | 平台 `.node`，由 Rust 包构建与 stage | 生产 mailbox/single-flight/submission |
| createTestRuntime / EffectHarness | `@graphvideo/sdk/testing` | 单次测试独立创建和销毁 |
| 实例事实与显式离线查询 | `@graphvideo/sdk/analysis` | 只读派生证据，不执行 change/Effect |

```bash
npm --prefix packages/desktop test -- app/plugins/hello-counter/backend.test.mjs --silent
npm --prefix packages/desktop test -- app/plugins/hello-counter/tests/native-graph-host.test.mjs --silent
npm --prefix packages/desktop run diagnose -- validate
```

`backend.test.mjs` 用构造注入的 Adapter 演示物理执行测试夹具，不将测试节点放入生产插件工厂。原生宿主测试验证运行、EncodedValue 投影与热替换：等待单飞间隙后丢弃旧 backlog，新 State 从初值启动，generation 增加。

同一 Node 的多个 change 串行；单个 WorldNode change 可以并发等待独立 Adapter 后集中写 State；物理任务可以同时在途。当前 NativeRuleSpace JS pump 逐个等待 handler，这些语义不承诺多个 JS change 回调同时执行。多节点扇出/扇入仍通过定向 Info 表达。详见[当前心智模型](../../../DOCUMENTS/mental-model.md)。
