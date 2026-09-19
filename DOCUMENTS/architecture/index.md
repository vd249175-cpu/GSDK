# 核心心智与架构 (Architecture)

本目录包含系统的最高事实级概念文档：运行本体、权限边界、不可破坏公理及核心生命周期。

## 概念清单

* [GraphFramework 当前心智模型](mental-model.md) - 系统的运行本体、单写者状态权限边界、原生 Rust 调度器契约与架构红线。
* [SDK 心智模型与包边界](sdk-mental-model.md) - SDK 各包职责、依赖拓扑方向与插件作者的核心契约边界。
* [Studio 应用生命周期](application-lifecycle.md) - Studio 应用的状态机流转、窗口与后台宿主生命周期，以及 generation 破坏性断代机制。
* [开发准入约束与架构红线](development-constraints.md) - 新增 Kernel、Node、字段与物理能力前的架构归属检查与红线清单。
