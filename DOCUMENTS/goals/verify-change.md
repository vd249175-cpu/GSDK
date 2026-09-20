---
type: Developer Guide
title: 为改动补测试并提交
description: 掌握针对性测试编写规范、执行两套类型检查与配置校验，并遵循 Git 小步提交原则。
status: stable
tags: [verification, testing, typecheck, git, definition-of-done]
---

# 为改动补测试并提交

本指南面向所有向 GraphFramework 贡献代码的开发者。在提交任何变更前，必须通过针对性测试、全套类型检查及配置校验，确保代码库处于高可信、随时可发布的状态。

---

## 提交前完成定义（Definition of Done）

任何功能修复、特性增加或代码重构，只有满足以下全套条件方可提交：

- [ ] **State 归属清晰**：每份业务 State 有明确且唯一的 Owner Node；
- [ ] **Info 类型静态可证明**：每个公开 Info 均有参数校验，每个内部 `ctx.send` 的 `type` 在发送点字面可见；
- [ ] **领域 Node 零 I/O**：纯业务 Node 绝不包含文件、网络、进程或系统 API；
- [ ] **针对性测试覆盖**：具备针对性单测，覆盖主要成功路径、边界与关键失败路径；
- [ ] **run 配置校验通过**：自己的 `runs/<name>/` 能通过 `validate` 校验，且仅通过 `run.sh` 启停；
- [ ] **两套类型检查通过**：`packages/desktop` 与 `packages/sdk/javascript` 的 TypeScript 检查均为 0 错误；
- [ ] **文档与契约同步**：源码修改与对应文档、导出的公开契约保持同步更新。

---

## 验证命令正本清单

命令正本维护在 [测试分层](../guides/testing.md) §验证命令，执行时严格使用以下对应命令：

### 1. TypeScript 类型检查（双包必跑）

```bash
# 检查桌面宿主与前端
npm --prefix packages/desktop run typecheck

# 检查 JavaScript/TypeScript SDK
npm --prefix packages/sdk/javascript run typecheck
```

### 2. 针对性单元测试

针对修改的单测文件执行测试（使用 `--silent` 抑制无关输出）：

```bash
npm --prefix packages/desktop test -- <测试文件路径> --silent

# 示例：针对 run 下开发中的 todo 插件测试
npm --prefix packages/desktop test -- runs/alice/plugins/example-todo/tests/todo.test.mjs --silent
```

### 3. run 配置校验

启动或提交前，校验 run 配置与装配合规性：

```bash
node packages/tooling/run/src/cli.mjs validate runs/<name>/run.config.json
```

### 4. 离线因果诊断校验

对插件进行静态因果可达性与规则检查：

```bash
node app/plugins/backend/hello-counter/scripts/diagnose.mjs validate
```

### 5. Rust 原生内核测试（仅当修改 packages/rust/ 时）

```bash
cargo test --manifest-path packages/rust/Cargo.toml -p <crate-name>

# 示例：运行 kernel 核心测试
cargo test --manifest-path packages/rust/Cargo.toml -p graphframework-kernel
```

---

## Git 小步提交与工作树治理

遵循良好工程实践，保障协作安全：

1. **小步快跑与频繁保存**：
   - 每完成一个原子逻辑、重构或单测通过后，及时建立 Git 提交检查点（checkpoint）。
   - 严禁在脏工作区上堆叠多个不相关的大改动。
2. **提交前自检**：
   - 提交前主动检查工作区：
     ```bash
     git status -s
     git diff
     ```
   - 确保不引入无意变动的临时文件、编译产物（`.generated/`）或个人凭据。
3. **测试驱动，拒绝黑盒盲测**：
   - 修复缺陷先写最小复现用例；
   - 验证单 Node 行为优先使用 `createTestRuntime`，不启动完整应用肉眼盲测；
   - 绝不使用 `node -e` 拼凑临时验证脚本。

---

## 下一步

- 测试策略与测试分层规则：[测试分层](../guides/testing.md)
- 如果测试中发现因果链未推进：[排查因果链不推进](debug-causal-flow.md)
- 发布与分发能力：[打包、安装或更新能力](distribute-capability.md)
