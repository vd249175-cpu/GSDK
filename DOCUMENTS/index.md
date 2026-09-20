---
okf_version: "0.2"
---

# GraphFramework 知识库总览

GraphFramework 是一个面向桌面与后端系统的因果应用框架。本知识库遵循 [Open Knowledge Format (OKF) 0.2](standards/SPEC.md)，并按“业务任务优先、平台原理下钻”组织。

## 默认入口

* [业务开发入门](guides/application-development.md) - 不阅读内核实现即可完成 Node、插件、测试、run 装配与启动。
* [测试分层](guides/testing.md) - 按改动范围选择最小验证。
* [Node 实例因果调试](diagnostics/debug-guide.md) - 从业务现象沿因果链定位断点。

## 知识子包索引

* [01-业务开发指南 (guides/)](guides/) - 业务开发主路径、前端、设计系统、测试，以及按需下钻的 SDK 参考。
* [02-排障、分析与技能 (diagnostics/)](diagnostics/) - 节点因果断点排查、全景查询模型与 Agent 自动化排障技能。
* [03-核心心智与架构 (architecture/)](architecture/) - 面向平台维护者的运行本体、权限边界与不可破坏公理。
* [04-底层与跨语言协议 (protocols/)](protocols/) - Rust 常驻内核调度协议、worker 租约机制与跨语言便携事实格式。
* [05-协作、分发与演进契约 (contracts/)](contracts/) - 插件全景契约、多 Agent 隔离运行规范与统一 run 实施计划。
* [06-规范标准定义 (standards/)](standards/) - OKF 0.2 格式规范全文与仓库本地采纳校验规则。

## 事实判断顺序

根据仓库开发准则，当信息出现冲突时，严格按以下顺序裁决：

```text
源码与针对性测试
  > architecture/mental-model.md
  > architecture/sdk-mental-model.md
  > guides/kernel-sdk-guide.md / plugin-sdk-guide.md / client-sdk-guide.md
  > 其他当前文档
```
