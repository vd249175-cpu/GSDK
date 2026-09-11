---
name: code-refactoring
description: >-
  Global AST-aware symbol renaming, reference tracking, and safe codebase refactoring
  using TypeScript LanguageService (scripts/refactor.mjs). Use when renaming classes,
  types, methods, interfaces, or variables across the whole repository, or performing
  safe global text replacements.
---

# Code Refactoring & Symbol Index Tool

## 1. 适用场景

当需要进行全仓级别的代码重构时使用此 Skill，包括：
- 跨文件重命名类（Class）、接口（Interface）、类型别名（Type Alias）、函数或变量名；
- 精准查找某个符号在全仓的所有引用位置与调用链路；
- 跨文件、全目录进行安全的文本/路径批量替换。

本工具基于当前工程 `node_modules/typescript` 提供的官方 **TypeScript Language Service**，具备与 VS Code `F2`（Rename Symbol）相同的 AST 语义分析能力，自动处理跨文件引用与 imports/exports 级联更新，不误伤同名局部变量。

---

## 2. 常用操作指令

所有操作均通过 `run_command` 执行：

### 2.1 跨文件全局重命名（AST 级别）

```bash
node scripts/refactor.mjs rename <file-path> <old-symbol-name> <new-symbol-name> [--line <line-number>]
```

**示例**：
- 重命名 `core/src/node.ts` 中声明的 `ExecutionWorldNode` 为 `ActionWorldNode`：
  ```bash
  node scripts/refactor.mjs rename core/src/node.ts ExecutionWorldNode ActionWorldNode
  ```
  *说明：工具会自动定位该类在 `core/src/node.ts` 的定义，并精准修改所有引用它的文件（如 `sdk/backend/index.ts` 等），同时自动修正 import 语句。*

- 如果同一文件存在多个同名符号（如函数名与局部变量重名），可使用 `--line` 指定目标行：
  ```bash
  node scripts/refactor.mjs rename core/src/context.ts effectAdapter executeEffect --line 116
  ```

---

### 2.2 查找全仓所有引用（Find References）

```bash
node scripts/refactor.mjs find-refs <file-path> <symbol-name> [--line <line-number>]
```

**示例**：
```bash
node scripts/refactor.mjs find-refs core/src/node.ts WorldNode
```
*输出全仓所有定义位置与引用位置（包含相对文件路径、行号与列号）。*

---

### 2.3 全仓文本/路径快速批量替换

适用于非 TypeScript 符号的路径、文档、配置文件批量变更：

```bash
node scripts/refactor.mjs replace-text <search-string> <replace-string> [--ext .ts,.tsx,.json,.md]
```

**示例**：
```bash
node scripts/refactor.mjs replace-text "@graphvideo/kernel" "@graphvideo/core"
```
*自动跳过 `node_modules/`、`dist/`、`.git/`，并递归替换匹配文件。*

---

## 3. 重构后的验证闭环

执行重构操作后，必须按照 [AGENTS.md](../../../AGENTS.md) 规定执行验证闭环：

```bash
# 1. 静态类型检查验证（必须 0 error）
npm run typecheck

# 2. 单元测试验证
npm test -- --silent
```
