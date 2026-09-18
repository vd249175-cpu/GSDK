# 底层与跨语言协议 (Protocols)

本目录记录微内核对内调度、跨进程/跨语言通信以及事实序列化交互的标准协议。

## 概念清单

* [常驻 Rust 图宿主协议](kernel-daemon-protocol.md) - 语言无关的 worker/provider 租约机制、poll/commit 调度模型与动态因果分析。
* [跨语言 Node 与便携分析事实协议](portable-node-protocol.md) - 跨语言 Node 的进程帧、Rust C ABI 接口契约与 PortableAnalysisSnapshot 分析事实格式。
