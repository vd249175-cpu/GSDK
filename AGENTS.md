# GraphFramework SDK 开发守则

## 1. 良好开发习惯

- **Git 小步提交与多做保存**：
  - 养成阶段性提交好习惯，小步快跑。每完成一个原子逻辑、重构或测试通过后，多用 Git 保存检查点（checkpoint）。
  - 提交前主动检查 `git status -s` 与 `git diff`，确保不引入无意变动的脏文件或未清理的临时文件。
  - 保证工作树随时处于干净、可追踪、随时可安全回滚的状态，严禁在脏工作区上堆叠多个不相关的大改动。
- **测试驱动与针对性验证**：
  - 修复缺陷或扩展能力时，先写最小复现用例或单测。
  - 排障优先验证最小局部，不无意义全量跑批；不启动黑盒开发服务器进行肉眼盲测。
- **确定性与整洁原则**：
  - 不使用 `node -e` 拼凑临时验证脚本。
  - 源码修改与文档更新同步进行，随时保持文档与实现一致。

## 2. 事实顺序

开始修改前必须先读 `DOCUMENTS/mental-model.md`。信息冲突时按以下顺序判断：

```text
源码与针对性测试
  > DOCUMENTS/mental-model.md
  > DOCUMENTS/sdk-mental-model.md
  > DOCUMENTS/kernel-sdk-guide.md / plugin-sdk-guide.md / client-sdk-guide.md
  > 其他当前文档
```

本仓库不保存退役架构文档。出现 Socket Kernel、声明边、Wrapper、Transition Registry 或旧应用私有绑定等说法，应视为外部旧资料，不得据此改代码。

## 3. 架构红线

1. `core/src` 是零业务语义微内核；`workbench/` 是零业务语义的前端工作台底座，不得导入具体业务插件。
2. Node 间通信只使用 `ctx.send(info, targetNodeId)`；不得增加 flows、Edge、Wrapper 或全局广播总线。
3. 每个 `ctx.send` 的 `Info.type` 必须能在当前 change 分支或发送点静态可证明。禁止把完整 Info 隐藏在不透明构造函数中；`unresolved-info-type` 是必须修复的校验错误。
4. State 只能由 Owner Node 在当前 `change ctx` 中写入；外部节点只能通过发送 Info 请求变迁。
5. 纯领域 Node 零 I/O、零系统 API。
6. **WorldNode 严格分为两类，观察和执行必须物理分离，不得混合**：
   - **执行类（`ExecutionWorldNode`）**：主动向物理系统下发动作、修改外部状态、提交任务并获取 handle。执行完成立即结算 change，零持续监听职责，不兼任轮询；
   - **观察类（`ObservationWorldNode`）**：监听物理世界事件、轮询任务状态或接收系统回调，将感知到的物理事实作为 Observation 封装为 Info。零主动外部写操作；
   - 物理动作只经构造注入的 `EffectAdapter` 执行。
7. Projection state 是 `EncodedValue`，读取必须经 `valueCodec.decode`；UI 业务事实只来自投影，不得在前端伪造第二份业务状态。
8. 所有业务均为平等插件；内置插件与第三方插件采用同一 Manifest、SDK、装载器和生命周期。

## 4. 标准排障流程

1. 确认目标 Node ID、State Owner 和物理隔离边界。
2. 沿 `Info → change → State → send/effect → Projection` 定位断点，查清因果推进在哪一步中断或异常。
3. 验证单 Node 行为优先使用 `@graphvideo/sdk/testing` 的 `createTestRuntime`，通过 mock Adapter 和 `waitForQuiescence()` 验证确定性收敛。
4. 将修复固化为针对性单元测试，再执行全套静态与类型检查。

## 5. 修改后的验证

- 针对性测试：只跑与修改直接相关的 Vitest，使用 `--silent`。
- 类型检查：代码修改必须通过 `npx tsc --noEmit`。
- 构建验证：修改涉及 package 源码或导出时执行 `npm run build:sdk`。
- 交付验收：交付前执行 `npm run export:sdk`（构建/导出串行，必须通过仓外三项严格验收）。
- 不无意义运行全量测试，不使用 `node -e` 临时拼凑验证。

## 6. 文档维护

- 当前文档只描述已存在的源码，不写迁移史和未来假想架构。
- 文档示例必须使用当前 `@graphvideo/*` 公开 API，严禁引用已废弃或不存在的文件/方法。
- Markdown 文件遵循 OKF 0.2 知识包规范（必须包含合法的 `type` frontmatter）。
