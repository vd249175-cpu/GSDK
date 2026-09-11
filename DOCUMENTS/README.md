---
type: index
---

# GraphFramework 文档导航

GraphFramework 是一个面向桌面与后端系统的因果应用微内核运行时。本目录只记录当前源码已经具备的结构、API 与开发约束，不保存迁移史、交付计划或旧应用私有架构。出现冲突时，以源码与针对性测试为准，其次是 `mental-model.md`。

## 核心模型

- [当前心智模型](./mental-model.md)：运行本体、权限边界、原生微内核调度与不可破坏公理。
- [SDK 心智模型](./sdk-mental-model.md)：包职责、依赖方向和代码归属。
- [Kernel 与 Node SDK](./kernel-sdk-guide.md)：Node、WorldNode、submission、Projection 与原生规则空间（NativeRuleSpace）。

## 开发指南

- [Plugin SDK](./plugin-sdk-guide.md)：插件装配、rendererRoots、Manifest 与热替换边界。
- [Client 与 Element SDK](./client-sdk-guide.md)：前端快照、客户端 hooks 与 Workbench Element。
- [Node 实例因果调试](./debug-guide.md)：从精确实体定位因果断点。
- [实例因果分析](./causal-analysis.md)：静态索引、路径、视角、健康和社区结果的证据边界。
- [测试分层](./testing.md)：当前测试项目、命令与选用规则。
- [设计系统](./design-system.md)：主题、语义 Token 与排版边界。
- [开发准入约束](./development-constraints.md)：新增 Kernel、Node、字段与物理能力前的归属检查。

## 文档约定

- [OKF 文档包约定](./okf.md)：frontmatter 与当前事实文档规则。

## 常用验证

```bash
npx tsc --noEmit
npm test -- --silent
npm --prefix apps/local-app run diagnose -- validate
npm run verify:app
cargo test --workspace
```
