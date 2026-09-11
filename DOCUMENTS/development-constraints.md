---
type: reference
---

# 开发准入约束

## 1. 先判归属

新增能力、类型、字段或目录前，先回答：

1. 唯一 Owner 是谁？
2. 它属于 Kernel、业务插件、物理宿主、renderer 投影、临时 UI 状态还是分析层？
3. 现有 Node / Info / State / change / EffectAdapter / Projection 是否已经能表达？
4. 它是不可替代的事实，还是可重新计算的派生值？
5. 它何时创建、更新、清除和失效？

说不清时不增加。业务语义进入插件；通用前端机制进入 Workbench；物理能力进入 WorldNode 与构造注入的 Adapter；只有保证图执行正确性且无法由现有本体表达的通用能力才进入 Kernel。

## 2. Kernel 五项检查

Kernel 新增项必须同时满足：

| 检查 | 要求 |
| :--- | :--- |
| 通用性 | 可用不含 GraphVideo 词汇的第二个图应用说明 |
| 正确性 | 用于调度、一致性、隔离或可观测正确性 |
| 不可表达性 | 不能由现有图本体或宿主组合表达 |
| 无能力性 | 不执行文件、网络、数据库、进程、媒体或窗口操作 |
| 最小表面 | API/字段是最小集合，并有针对性测试 |

Kernel 不包含业务 Info/Node ID、Registry、声明边、Wrapper、广播、页面快捷调用或分析专用字段。

## 3. Node、Info 与 State

- 拆出新 Node 需要独立 State 生命周期、mailbox/资源竞争、物理 Effect、安全失败边界或稳定自治协议之一；代码较长或想复用函数不是理由。
- State 保存 Owner 已接受且跨 change 持续的事实，不保存推测、UI 临时态或可计算副本。
- Info payload 只带接收方完成该 change 所需的最小因果数据；发送即走，需要结果时用新的 Observation/Result Info 闭环。
- `Info.type` 在发送点静态可证明；不使用别名 Registry 或根据 payload 猜类型。
- submission 是一次根提交的完成范围，不是业务全局任务模型；取消不回滚已写 State 或已完成副作用。

## 4. 字段准入

持久字段必须有唯一 Owner、唯一写入路径、消费者、初值/空值语义和清除规则，并说明为何不能从现有字段推导。禁止：

- 同义别名与无限扩展的 `metadata/context/options/extra` 袋；
- 把 Node ID、UI 组件名、绝对路径、函数或类实例放入业务 State/Projection；
- 在多层保存同一业务事实并互相同步；
- 为分析方便给生产 Node 增加社区、折叠、边权等字段。

## 5. 物理与前端边界

- 纯领域 Node 零 I/O；ExecutionWorldNode 与 ObservationWorldNode 物理分离。
- Adapter 只接受/返回 DTO，不读写其他 Node State，也不调用 `ctx.send`。
- renderer 只调用 preload 固定命令、注入经过 `rendererRoots` 授权的意图并读取 Projection DTO。
- 选择、草稿、焦点、tab、布局和弹窗属于 ClientState、ElementState 或组件局部状态。
- `sdk/workbench` 不导入具体业务插件；共享组件只有在零业务 State/Info/Application 方法依赖时才可上移。

## 6. 变更同步

| 变更 | 同步内容 | 最低验证 |
| :--- | :--- | :--- |
| Kernel API/调度 | mental-model、Kernel 指南、针对性测试 | Vitest + `tsc` |
| Node/Info/State | 插件装配、因果文档、针对性测试 | `diagnose -- validate` |
| Projection/rendererRoots | 解码、消费者、前端联动表 | 应用测试 + 诊断 |
| EffectAdapter | Factory 注入、WorldNode、Observation 测试 | 针对性测试 + `tsc` |
| Workbench/主题 | 设计系统、样式与 UI 测试 | `test:ui` |
| Electron/runtime 构建 | 构建文档与应用验收 | `verify:app` |

文档只描述当前已经存在的能力；不要用兼容层、旧别名或假想计划掩盖所有权问题。
