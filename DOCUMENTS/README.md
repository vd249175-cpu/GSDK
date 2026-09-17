---
type: index
---

# GraphFramework 文档导航

GraphFramework 是一个面向桌面与后端系统的因果应用微内核运行时。本目录记录当前结构、API、开发约束与已约定的协作交付契约；交付要求单独标明，不作为已实现能力声明。出现冲突时，以源码与针对性测试为准，其次是 `mental-model.md`。

## 核心模型

- [当前心智模型](./mental-model.md)：运行本体、权限边界、原生微内核调度与不可破坏公理。
- [SDK 心智模型](./sdk-mental-model.md)：包职责、依赖方向和代码归属。
- [Kernel 与 Node SDK](./kernel-sdk-guide.md)：Node、WorldNode、submission、Projection 与原生规则空间（NativeRuleSpace）。

## 开发指南

- [Plugin SDK](./plugin-sdk-guide.md)：插件装配、rendererRoots、Manifest 与热替换边界。
- [插件发布与协作契约](./plugin-collaboration-contract.md)：正式插件所有权、禁止污染、独立插件扩展、OKF 交付说明与推荐折叠规则。
- [多 Agent 独立开发与运行协作指南](./multi-agent-run-guide.md)：已确认的命名 run、目录所有权、Bash 启停和并行隔离目标，尚未实现。
- [统一 run 实施计划](./unified-run-plan.md)：将完整 Studio、图片段和场景测试迁入同一配置驱动运行机制的阶段与验收。
- [插件全景与契约索引](./plugins-reference.md)：业务插件规范、Node/Info/Element 清单与内核稳定消费规约。
- [Client 与 Element SDK](./client-sdk-guide.md)：前端快照、客户端 hooks 与 Workbench Element。
- [Node 实例因果调试](./debug-guide.md)：从精确实体定位因果断点。
- [实例因果分析](./causal-analysis.md)：静态索引、路径、视角、健康和社区结果的证据边界。
- [跨语言 Node 与分析事实协议](./portable-node-protocol.md)：进程 Node 帧、Rust C ABI 与便携分析快照。
- [常驻 Rust 图宿主协议](./kernel-daemon-protocol.md)：语言无关 worker/provider 租约、poll/commit、Agent 与动态分析。
- [测试分层](./testing.md)：当前测试项目、命令与选用规则。
- [设计系统](./design-system.md)：主题、语义 Token 与排版边界。
- [开发准入约束](./development-constraints.md)：新增 Kernel、Node、字段与物理能力前的归属检查。

## 文档约定

- [OKF 文档包约定](./okf.md)：frontmatter 与当前事实文档规则。

## 目录边界

- [当前目录与分发边界](./package-distribution-restructure-plan.md)：应用装配、插件归属、镜像 SDK、统一工作台和桌面构建。
- [SDK 与插件分发验收契约](./distribution-contract.md)：七能力面镜像、独立制品、版本兼容、外部目录演练与性能要求。
- [通用桌面宿主接入](../packages/desktop/README.md)：安装、构建、应用配置与原生绑定。
- [Counter 示例与离线诊断](../app/plugins/hello-counter/README.md)：最小 Node 链路、诊断命令和复用入口。

## 首次源码接入

在仓库根目录执行，使用本机 Rust 工具链；本流程不自动安装编译器：

```bash
npm --prefix packages/sdk/javascript ci
npm --prefix packages/desktop ci
cargo build --manifest-path packages/rust/Cargo.toml -p graphvideo-kernel-node
node packages/rust/scripts/stage-native.mjs
node packages/rust/scripts/stage-backend-native.mjs
npm --prefix packages/desktop run build
```

桌面源码构建消费 SDK 源码，不要求先生成 SDK dist JavaScript；原生绑定仍需构建和暂存。默认启用 Studio。启动命令是 `npm --prefix packages/desktop run start`，窗口启动和关闭由图内 Info 推进，关闭窗口后宿主继续运行。源码 file 依赖不等于独立发布制品，分发按上述契约另行验收。

## 常用验证

```bash
npm --prefix packages/sdk/javascript run typecheck
npm --prefix packages/desktop run typecheck
npm --prefix packages/desktop test -- <目标> --silent
npm --prefix packages/desktop run diagnose -- validate
npm --prefix packages/desktop run verify
cargo test --manifest-path packages/rust/Cargo.toml -p <crate>
```
