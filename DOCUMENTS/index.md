---
okf_version: "0.2"
---

# GraphFramework 知识库总览

GraphFramework 是一个面向桌面与后端系统的因果应用微内核运行时。本知识库遵循 [Open Knowledge Format (OKF) 0.2](standards/SPEC.md) 组织，按架构事实与开发阶段分层维护。

## 知识子包索引

* [01-核心心智与架构 (architecture/)](architecture/) - 系统的运行本体、单写者权限边界、原生微内核调度与不可破坏公理。
* [02-底层与跨语言协议 (protocols/)](protocols/) - Rust 常驻内核调度协议、worker 租约机制与跨语言便携事实格式。
* [03-开发者与 SDK 指南 (guides/)](guides/) - Kernel、Plugin、Client SDK 开发指南、统一主题设计系统与测试分层规范。
* [04-协作、分发与演进契约 (contracts/)](contracts/) - 插件全景契约、多 Agent 隔离运行规范与统一 run 实施计划。
* [05-排障、分析与技能 (diagnostics/)](diagnostics/) - 节点因果断点排查、全景查询模型与 Agent 自动化排障技能。
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
