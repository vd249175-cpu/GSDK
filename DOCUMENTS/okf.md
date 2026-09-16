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
  指南/领域/协作约定）、`index`（导航）；正式插件 PACKAGE.md 推荐 `package`。
- 可选：`title`、`description`。其余 OKF 可选键（`resource`、`tags`、
  `generated`、`sources`、`verified`、`status`、`stale_after`）按需使用，
  不强制。
- `type` 之后如需扩展取值，应先明确文档归属与用途。

## 3. 保留文件名与入口

- `README.md`（`type: index`）是导航入口，`mental-model.md` 是架构事实入口。
- 概念文件一概念一文件；报告类派生物（如架构报告）不在包内，
  由事实源重新生成。

## 4. 正文规则

- 实现说明只描述已存在的源码与已交付能力，不写迁移史与假想架构。已约定的协作、分发与验收要求可以作为规范保留，但必须与当前实现状态分开，不能提前宣称通过。
- 代码示例只用当前 `@graphvideo/*` 公开入口；不断言未经验证的内容。
- 概念间引用用相对路径 Markdown 链接；断链是质量问题，不是 OKF 错误，
  由交付检查单独覆盖。

## 5. 校验

在仓库根目录的 PowerShell 中执行：

```powershell
$okfFailures = @()
Get-ChildItem DOCUMENTS -Recurse -File -Filter '*.md' | ForEach-Object {
  $okfText = [IO.File]::ReadAllText($_.FullName).TrimStart([char]0xFEFF).Replace("`r`n", "`n")
  $okfHeader = [regex]::Match($okfText, '\A---\n([\s\S]*?)\n---(?:\n|$)')
  if (-not $okfHeader.Success -or $okfHeader.Groups[1].Value -notmatch '(?m)^type:\s*\S+') {
    $okfFailures += $_.FullName
  }
}
if ($okfFailures.Count) { throw ($okfFailures -join "`n") }
'OKF shape OK'
```

注意仓库文件为 CRLF，解析前必须同时容忍 BOM 与 `\r\n`。
根 `AGENTS.md` 和插件资源中的原生 Agent 配置不参与 DOCUMENTS 校验。`DOCUMENTS/agent-guides/` 中的指南与引用文件属于知识包，保留 name/description 等字段的同时包含 type。整个代码交付目录不宣称为 OKF bundle；链接与 API 有效性另行检查。
