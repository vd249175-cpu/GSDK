---
type: guide
name: code-refactoring
description: >-
  Global AST-aware symbol renaming, reference tracking, and safe codebase refactoring
  using TypeScript LanguageService (packages/tooling/refactor/refactor.mjs). Use when renaming classes,
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

以下命令在仓库根目录执行。先用 `npm --prefix packages/tooling/refactor ci` 安装工具依赖。所有命令可传 `--project <tsconfig>`；文件路径相对于该配置目录，默认以 JavaScript SDK 为项目根。LanguageService 范围由 tsconfig 决定，并不自动涵盖整个仓库：

### 2.1 跨文件全局重命名（AST 级别）

```bash
node packages/tooling/refactor/refactor.mjs rename <file-path> <old-symbol-name> <new-symbol-name> [--line <line-number>]
```

**示例**：
- 重命名 `packages/sdk/javascript/src/node/node.ts` 中声明的 `ExecutionWorldNode` 为 `ActionWorldNode`：
  ```bash
  node packages/tooling/refactor/refactor.mjs rename src/node/node.ts ExecutionWorldNode ActionWorldNode
  ```
  *说明：工具会自动定位该类在 `packages/sdk/javascript/src/node/node.ts` 的定义，并精准修改所有引用它的文件（如 `packages/sdk/javascript/src/node/native-space.ts` 等），同时自动修正 import 语句。*

- 如果同一文件存在多个同名符号（如函数名与局部变量重名），可使用 `--line` 指定目标行：
  ```bash
  node packages/tooling/refactor/refactor.mjs rename src/node/context.ts <old-symbol> <new-symbol> --line <line-number>
  ```

---

### 2.2 查找全仓所有引用（Find References）

```bash
node packages/tooling/refactor/refactor.mjs find-refs <file-path> <symbol-name> [--line <line-number>]
```

**示例**：
```bash
node packages/tooling/refactor/refactor.mjs find-refs src/node/node.ts WorldNode
```
*输出所选 TypeScript 项目内的定义位置与引用位置（包含相对文件路径、行号与列号）。*

---

### 2.3 全仓文本/路径快速批量替换

适用于非 TypeScript 符号的路径、文档、配置文件批量变更：

```bash
node packages/tooling/refactor/refactor.mjs replace-text <search-string> <replace-string> [--ext .ts,.tsx,.json,.md]
```

**示例**：
```bash
node packages/tooling/refactor/refactor.mjs replace-text "<old-doc-path>" "<new-doc-path>" --ext .md
```
*自动跳过 `node_modules/`、`dist/`、`.git/`，并递归替换匹配文件。*

---

## 3. 重构后的验证闭环

文件移动优先使用 LanguageService/AST，而不是全局文本替换：

```bash
node packages/tooling/refactor/refactor.mjs move <from> <to> --project <tsconfig>
node packages/tooling/refactor/rewrite-imports.mjs <scope> <old-module> <new-module>
```

move 支持仓库内单文件移动。跨项目引用分别选择 tsconfig 检查；资源 URL、构建配置和 JSON 装配路径也要核对。rewrite-imports 只修改模块路径、类型查询、mock 与 import.meta.url 资源 URL，普通文本替换不具备符号或路径安全性。

执行重构操作后，必须按照 [AGENTS.md](../../../AGENTS.md) 规定执行验证闭环：

```bash
# 1. 静态类型检查验证（必须 0 error）
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck

# 2. 单元测试验证
npm --prefix packages/desktop test -- <target-test> --silent
node packages/tooling/refactor/check-layout.mjs
```
