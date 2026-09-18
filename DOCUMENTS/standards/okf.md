---
type: Format Specification
title: OKF 文档包约定与本地采纳
description: DOCUMENTS 作为 OKF 0.2 知识包的本地形状约定、采纳字段、目录分层与校验规则。
status: stable
tags: [okf, conventions, validation, local-rules]
---

# OKF 文档包约定

`DOCUMENTS/` 是一个严格遵循 [Open Knowledge Format (OKF) 0.2](SPEC.md) 的知识包：概念即单个 UTF-8 Markdown 文件，YAML frontmatter（上下各一行 `---` 栅栏）+ 结构化正文，概念之间用标准 Markdown 链接关联。

## 1. 目录分层与保留文件

知识包依据 OKF 0.2 §3 与 §8 采用分层结构，避免扁平堆叠，支持渐进式披露（Progressive Disclosure）：

```text
DOCUMENTS/
├── index.md             # [保留文件] 根级清单，携带 okf_version: "0.2"
├── log.md               # [保留文件] 知识包历史变更日志 (OKF §9)
├── README.md            # GitHub 仓库阅读导航入口
├── architecture/        # 核心心智模型、运行本体与架构红线
│   └── index.md         # 子包渐进披露清单
├── protocols/           # 常驻 Rust 内核与跨语言协议
├── guides/              # Kernel、Plugin、Client SDK 开发指南与测试规范
├── contracts/           # 插件全景、多 Agent 隔离与统一 run 计划
├── diagnostics/         # 排障指南、因果分析与 agent-guides/ 技能
└── standards/           # OKF 规范全文 (SPEC.md) 与本地约定 (okf.md)
```

## 2. 字段规范与元数据

- **必需字段**：非空 `type`。概念文件缺失 `type` 或 frontmatter 缺失属于合规错误。
- **推荐字段**：
  - `title`：文档正式标题。
  - `description`：单句单行摘要，供各级 `index.md` 提取与 Agent 零全文快速决策。
  - `status`：`stable` | `draft` | `deprecated`。严禁将规划中/草案契约标为 stable。
  - `tags`：YAML 数组形式的跨切面标签。
- **语义类型（`type` 取值）**：
  - `Architecture Specification`：核心架构与心智
  - `Protocol Specification`：通信与事实序列化协议
  - `Developer Guide`：开发与测试手册
  - `Contract`：发布、分发与协作契约
  - `Plan`：演进与实施方案
  - `Playbook`：排障排错手册与技能
  - `Format Specification`：格式标准规范

## 3. 保留文件名规范

- `index.md`：目录清单（Directory Listing）。用于自描述与渐进式展开。**无常规 frontmatter**（除根目录可携带 `okf_version: "0.2"` 外），不写业务正文。
- `log.md`：按 ISO 8601 日期倒序平铺记录知识包演进历史。

## 4. 事实判断顺序

当文档信息与源码出现冲突时，以源码与针对性测试为准，其次是 `architecture/mental-model.md`：

```text
源码与针对性测试
  > architecture/mental-model.md
  > architecture/sdk-mental-model.md
  > guides/kernel-sdk-guide.md / plugin-sdk-guide.md / client-sdk-guide.md
  > 其他当前文档
```

## 5. 校验规则

保留文件（`index.md`、`log.md`）不要求 `type` 字段；其余所有 `.md` 概念文件必须包含有效 YAML frontmatter 且具备非空 `type`、`title`、`description`。
断链属于质量交付问题，由全局链接扫描器独立覆盖。
