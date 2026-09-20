---
okf_version: "0.2"
---

# GraphFramework 知识库总览

本知识库遵循 [Open Knowledge Format (OKF) 0.2](standards/SPEC.md) 规范。人类开发者请直接访问 **[文档中心导航 (README.md)](README.md)** 进入三层结构。

## 知识子包索引

* [01-目标入口 (goals/)](goals/) - 面向具体端到端任务的操作指南（准备环境、开发功能、接入外部世界、界面、run、测试验证、排障、打包分发、内核演进、多语言）。
* [02-核心心智与架构 (architecture/)](architecture/) - 运行本体、权限边界、代码归属与不可破坏公理。
* [03-底层与跨语言协议 (protocols/)](protocols/) - Rust 常驻内核调度协议、worker 租约机制与跨语言便携事实格式。
* [04-SDK 与开发参考 (guides/)](guides/) - Node、Plugin、Client SDK 开发指南、设计系统与测试规范。
* [05-协作、分发与演进契约 (contracts/)](contracts/) - 插件全景契约、多 Agent 隔离运行规范与分发协作契约。
* [06-排障、分析与技能 (diagnostics/)](diagnostics/) - 节点因果断点排查、全景查询模型与自动化排障技能。
* [07-规范标准定义 (standards/)](standards/) - OKF 0.2 格式规范全文与仓库本地采纳校验规则。

## 事实判断顺序

根据仓库开发准则，当信息出现冲突时，严格按以下顺序裁决：

```text
源码与针对性测试
  > architecture/mental-model.md
  > architecture/sdk-mental-model.md
  > guides/kernel-sdk-guide.md / plugin-sdk-guide.md / client-sdk-guide.md
  > 其他当前文档
```
