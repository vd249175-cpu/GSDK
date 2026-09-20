# 核心心智与架构 (Architecture)

本目录包含系统的最高事实级概念文档：运行本体、权限边界、不可破坏公理及核心生命周期。

## 概念清单

* [GraphFramework 当前心智模型](mental-model.md) - 系统的运行本体、单写者状态权限边界、原生 Rust 调度器契约与架构红线。
* [平台 SDK 心智模型与包边界](sdk-mental-model.md) - 面向平台和高级插件维护者的包职责、依赖方向与契约边界。
* [命名 run 生命周期](application-lifecycle.md) - run.sh 启停阶段、活动快照、关闭语义与 generation 破坏性断代机制。
* [开发准入约束与架构红线](development-constraints.md) - 新增 Kernel、Node、字段与物理能力前的架构归属检查与红线清单。
