---
type: reference
---

# 测试分层与验证入口

根目录不持有 npm 构建或测试工作区。按改变的责任边界选择针对性测试。

| 范围 | 位置 | 入口 |
| --- | --- | --- |
| JavaScript SDK | `packages/sdk/javascript/tests` | `npm --prefix packages/sdk/javascript test -- <目标> --silent` |
| 桌面宿主 | `packages/desktop/host`、`application.test.mjs` | `npm --prefix packages/desktop test -- <目标> --silent` |
| 插件 | `app/plugins/*` | 桌面测试配置加载相应插件测试 |
| 前端工作台与主题 | `packages/frontend/*` | 桌面测试配置提供 jsdom 环境 |
| Python SDK | `packages/sdk/python/tests` | `python -m pytest packages/sdk/python/tests` |
| Rust | `packages/rust` | `cargo test --manifest-path packages/rust/Cargo.toml -p <crate>` |

桌面测试排除 node_modules、构建产物与真实外部服务测试。使用真实 Node 和生产调度或 SDK 测试运行时，只替换构造注入的 Adapter；断言 State、Info、Effect、Projection 和 submission 结算。

```bash
npm --prefix packages/sdk/javascript run typecheck
npm --prefix packages/desktop run typecheck
npm --prefix packages/desktop run check:renderer-boundary
node packages/tooling/refactor/check-layout.mjs
npm --prefix packages/desktop run build
npm --prefix packages/desktop run verify:native-load
npm --prefix packages/desktop run diagnose -- validate
git diff --check
```

SDK 类型检查不依赖 frontend；客户端泛型断言位于 `packages/frontend/client/typecheck.ts`，由桌面 renderer 类型检查包含。Electron smoke 加载实际桌面宿主构建产物和 Rust .node，验证调度、Projection 与清理。诊断命令使用 JS SDK 源码条件，不启动桌面应用。
