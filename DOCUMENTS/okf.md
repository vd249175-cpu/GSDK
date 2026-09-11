---
type: guide
title: OKF 文档包约定
description: DOCUMENTS 作为 OKF 0.2 知识包的形状约定、采用的字段与校验规则。
---

# OKF 文档包约定

`DOCUMENTS/` 是一个 OKF 0.2 知识包：概念即单个 UTF-8 Markdown 文件，
YAML frontmatter（上下各一行 `---` 栅栏）+ 自由正文，概念之间用普通
Markdown 链接关联。上游权威：<https://openknowledgeformat.com>（v0.2，
2026-07）与 <https://turva.dev/guides/open-knowledge-format>。OKF 只标准化
文件形状，不标准化概念含义；本文件只记录本仓库实际采用的契约。

## 1. 唯一必需

- 每个概念文件有且仅有一个必需字段：非空 `type`。
- 缺 `type`、空 `type`、frontmatter 缺失是硬错误；其他一律不是。
- 未知 `type` 值、未知字段、缺少可选元数据、断链，都不能判作 OKF 错误。

## 2. 本包采用的字段

- `type`：本包使用的值为 `reference`（心智/约束/结构/调试）、`guide`（SDK
  指南/领域/约定）、`index`（导航）。
- 可选：`title`、`description`。其余 OKF 可选键（`resource`、`tags`、
  `generated`、`sources`、`verified`、`status`、`stale_after`）按需使用，
  不强制。
- `type` 之后如需扩展取值，应先明确文档归属与用途。

## 3. 保留文件名与入口

- `mental-model.md` 是事实入口，供人与 Agent 扫描当前架构。
- 概念文件一概念一文件；报告类派生物（如架构报告）不在包内，
  由事实源重新生成。

## 4. 正文规则

- 只描述已存在的源码与已交付能力；不写迁移史与未来假想架构。
- 代码示例只用当前 `@graphvideo/*` 公开入口；不断言未经验证的内容。
- 概念间引用用相对路径 Markdown 链接；断链是质量问题，不是 OKF 错误，
  由交付检查单独覆盖。

## 5. 校验

```bash
node -e "
const {readFileSync,readdirSync}=require('fs');
for(const f of readdirSync('DOCUMENTS').filter(f=>f.endsWith('.md'))){
  const t=readFileSync('DOCUMENTS/'+f,'utf8').replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
  const m=t.match(/^---\n([\s\S]*?)\n---/);
  if(!m||!/^type:\s*\S+/m.test(m[1])){console.log('FAIL',f);process.exitCode=1}
}
console.log('OKF shape OK')"
```

注意仓库文件为 CRLF，解析前必须同时容忍 BOM 与 `\r\n`。
`AGENTS.md` 与 `.agents/skills/` 保留原生格式，不是 OKF 概念，
不参与本校验；整个代码交付目录也不宣称为 OKF bundle。
