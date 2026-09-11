---
type: reference
---

# 测试分层与验证入口

测试按失败所代表的边界选择，而不是一律运行全套。当前根 Vitest 配置包含三个 project，本地应用和 Rust 使用各自入口。

## 1. 当前分层

| 范围 | 位置 | 验证内容 | 命令 |
| :--- | :--- | :--- | :--- |
| `core` | `core/**/*.test.ts` | KernelRuntime、mailbox、single-flight、submission、取消、Projection | `npm run test:core -- --silent` |
| `unit` | `sdk/**/*.test.{ts,mjs}`，排除 workbench | backend、testing、analysis、contract 等机制 | `npm run test:unit -- --silent` |
| `ui` | `sdk/workbench/**/*.test.{ts,tsx}` | Workbench、Element 生命周期、样式边界 | `npm run test:ui -- --silent` |
| `local-app` | `apps/local-app/plugins`、`src-main` | 插件、TS 参考宿主、原生宿主与热替换 | `npm run test:app` |
| Rust | `crates/kernel/tests` | 原生登记、队列、结算、取消、代次与替换 | `cargo test --workspace` |

根 `npm test -- --silent` 运行 core/unit/ui；`npm run verify:app` 还会构建 native/runtime，并执行 renderer 边界、应用类型、应用测试、因果校验、Electron 原生加载和 renderer build。

## 2. 按改动选测试

| 改动 | 最小验证 |
| :--- | :--- |
| Kernel 调度、State、submission | 对应 core 测试 + `npx tsc --noEmit` |
| Rust mailbox、结算或替换 | 对应 Cargo 测试 + native-space 测试 |
| backend-sdk 原生门面 | `sdk/backend/native-*.test.ts` + 类型检查 |
| Node / Info / State / rendererRoots | 插件测试 + `diagnose -- validate` |
| Electron/runtime 构建边界 | `npm run verify:app` |
| Workbench 组件或主题 | 对应 ui 测试；样式改动同时遵循设计系统 |
| analysis 算法 | 对应 `sdk/analysis/*.test.ts` |

## 3. Node 与 Effect 测试原则

- 使用真实生产 Node 与真实 Runtime 调度，不复制 change 逻辑。
- 只替换构造注入的 EffectAdapter，覆盖成功、失败、延迟和取消。
- 最小挂载明确列出 Node；区域外输出用简单 Collector 接收，不复制对方 State Owner。
- 优先断言最终 State、发送的 Info、Effect Request/Observation、Projection 和 submission 完成。
- 每个测试创建并销毁独立 Runtime，避免 Node 或 capability 在用例间泄漏。
- 固定 Clock、IdProvider 和可控 Promise 以消除 wall-clock 与随机性。

## 4. 构建边界回归

源码测试通过不等于 Electron 运行产物可加载。`build:runtime` 先生成唯一的 `core/dist`，backend runtime 外部引用 `@graphvideo/kernel`；应用测试同时导入 backend-sdk 与 Kernel，可防止重复 Kernel capability 回归。Electron smoke 再验证真实主进程版本加载 `.node`。

## 5. 提交前

```bash
npx tsc --noEmit
npm test -- --silent
cargo test --workspace
npm run verify:app
git diff --check
```

只在改动影响对应边界时扩大验证范围；文档-only 变更至少检查 frontmatter、链接、命令和 `git diff --check`。
