---
type: reference
title: AST 与 LanguageService 重构工具
---

# AST 与 LanguageService 重构工具

包根入口 `@graphframework/refactor` 导出可组合的 `rewriteImports(text, file, replace)`。三个可执行入口分别是 `graphframework-refactor`、`graphframework-rewrite-imports` 与 `graphframework-check-layout`；在本仓库内仍建议使用下述显式路径，方便审阅实际工具版本。

先运行 `npm --prefix packages/tooling/refactor ci` 安装工具依赖。以下命令在仓库根目录执行。

文件移动优先使用 `node packages/tooling/refactor/refactor.mjs move <from> <to> --project <tsconfig>`，它通过 TypeScript LanguageService 更新引用，并用 AST 调整被移动文件的模块路径。from、to 相对于 tsconfig 所在目录，支持仓库内单文件移动。

符号重命名使用 `rename <file> <old> <new> --project <tsconfig>`，查找引用使用 `find-refs <file> <symbol> --project <tsconfig>`。不传 project 时使用 JavaScript SDK 的 tsconfig。项目范围由所选 tsconfig 决定；跨项目变更需要分别检查。

精确模块路径替换使用 `node packages/tooling/refactor/rewrite-imports.mjs <scope> <old> <new>`。它只改 AST 中的模块路径、测试 mock 和相对于 import.meta.url 的资源 URL，不替换普通字符串。

`node packages/tooling/refactor/check-layout.mjs` 检查生产平台源码反向依赖业务插件、插件相互引用、失效相对模块路径和退役接口。构建输出、依赖及缓存不属于源目录。

工具验证使用 `node --test packages/tooling/refactor/rewrite-imports.test.mjs`。文件路径、构建配置和资源路径仍需要针对性构建与类型检查验证。
