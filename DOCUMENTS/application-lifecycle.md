---
type: reference
---

# Studio 应用生命周期

内核、拓扑与业务命令各自独立。`createEmptyNativeGraphHost` 创建空 Rust 规则空间，`mountPlugins` 装配节点，业务由另行注入的 Info 推进。正常停机先完成业务准备，再显式推出节点，最后关闭空规则空间；`NativeRuleSpace.shutdown` 不隐式卸载节点或保存数据。

## 应用协议

Studio 插件中的 `node-application-lifecycle` 是应用生命周期 State 的唯一 Owner，窗口 State 仍由 `host-el` 持有。启动根 Info 为 `SystemStartRequestedInfo`，携带 `requestId`；窗口执行与观察完成后，生命周期投影进入 `Ready`，失败进入 `StartFailed`。

`SystemShutdownRequestedInfo` 携带 `requestId` 和 `hasProject`，依次推进：

```text
StoppingGeneration → AwaitingDrain → Saving → ClosingWindow → ShutdownReady
```

- 生成 Owner 接收定向准备 Info，关闭自动轮询并拒绝新批次和轮询意图；仍处理已在途提交、下载和落盘的 Observation。外部已提交任务不被宣称为远端取消。
- 生成准备回执后进入 `AwaitingDrain`。宿主确认已接纳的工作收敛后，注入同一 requestId 的 `SystemShutdownDrainObservedInfo`；不能仅凭某个 submission 完成就跨过此屏障。
- Markdown Owner 提供当前文档，SQLite Owner 提供当前元数据和保留记录，执行节点通过注入 Adapter 做完整项目保存，观察节点将落盘结果回传。只有 `shutdown/<requestId>` 对应的结果才能完成本轮准备；没有打开项目时跳过保存。
- 保存成功后才请求关闭窗口。窗口执行结果经观察回传，应用投影才进入 `ShutdownReady`。保存或窗口失败进入 `ShutdownFailed`，不报告退出成功。

回执类型是 `StudioLifecycleParticipantPreparedInfo`，明确携带 `requestId`、`participant` 与 `ok`。旧请求、重复或不符合当前阶段的回执不推进生命周期。Node 异常可由宿主定向至生命周期 Owner；活动阶段收到 `@error/NodeFailed` 会投影失败。宿主超时事实使用 `SystemLifecycleTimeoutObservedInfo`，不能把超时当成任务已停止。

生命周期测试显式导入插件 `backend.ts` 源码，防止旧的生成产物遮蔽当前实现。JS 因果事实的关系 ID 包含证据位置；同一 change 的不同发送或读写位置保留独立证据，同一位置的重复提取只保存一次，符合 Rust 分析对关系 ID 唯一性的校验。

## 资源边界

业务准备与资源销毁分开：保存发生在有效的 change 中，节点 `dispose` 只终结本地生命周期与释放资源。异步 `evict` 先密封投递，等当前 handler 结束后丢弃 backlog，再等待清理；超时节点仍密封。清理错误汇总返回，不能吞掉。窗口关闭与应用退出是不同意图，关闭窗口允许图继续驻留。
