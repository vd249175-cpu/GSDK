---
type: Contract
title: 知识库共享根目录协作契约
description: /root/knowledgeroot 作为通用知识与工作流正文唯一落地目录的位置、内容边界、首次启动配置与人机共同维护规则。
status: stable
tags: [knowledge-sharing, collaboration, knowledgeroot, maintenance]
---

# 知识库共享根目录协作契约

`/root/knowledgeroot` 是通用知识与工作流说明正文的唯一协作落地目录，由人与 Agent 共同维护。本文件只固定位置、内容边界与维护规则；分享策略的上位契约仍是[SDK、插件与协作分发契约](distribution-contract.md) §3。

## 1. 位置与访问

- 落地主机：`i-uf6fm76cksm8ipd5mfjy`（`cn-shanghai`，ECS）。
- 绝对路径：`/root/knowledgeroot`，2026-09-21 实测存在（`drwxr-xr-x`），当时含 `2026-09-20 10-38-03.mp4` 与 `image.png`。
- 唯一远程工具：阿里云 Workbench CLI（命令 `workbench`，2026-09-21 实测 `v1.0.1`）。用法知识以仓库已 vendor 的技能 `.agents/skills/alibabacloud-workbench-cli/SKILL.md` 为准（上游 `alibabacloud-workbench-cli` 原样，链接见下），按其 `exec` / `upload` / `download` / `session` / `daemon` 语义操作。`workbench daemon` 为按用户单例、首次调用自启，`daemon status` 探活。不建立直连 SSH、私有绑定或旁路通道。
-
- **首次启动三步（安装 → 凭证 → 探活）：**
-
- 1. 安装服务（`install.sh` 仅 Linux/macOS；Windows 走 `install.ps1`，`install.sh` 在 Git Bash 下直接拒绝）：
-
- ```bash
- # Linux / macOS
- curl -fsSL https://workbench-cli.oss-cn-hangzhou.aliyuncs.com/install.sh | bash
- ```
-
- ```powershell
- # Windows PowerShell（落点 %LOCALAPPDATA%\Programs\workbench\workbench.exe，写用户 PATH，需新终端生效）
- irm https://workbench-cli.oss-cn-hangzhou.aliyuncs.com/install.ps1 | iex
- ```
-
- 技能来源（用法唯一依据）：<https://github.com/aliyun/alibabacloud-aiops-skills/tree/master/skills/developertools/solutions/alibabacloud-workbench-cli>，已原样 vendor 至 `.agents/skills/alibabacloud-workbench-cli/SKILL.md`。验收：`workbench version` 打印版本号。
- 2. 配置凭证：Agent 直接写 `~/.workbench/config.json`（`0600`），不用交互式 `workbench config`；真实 AK 只落本地该文件，绝不写入仓库文档、共享目录或群聊：
-
- ```json
- { "current": "default", "profiles": { "default": { "mode": "AK", "access_key_id": "<AccessKeyId>", "access_key_secret": "<AccessKeySecret>" } } }
- ```
-
- 验收：`workbench config list` 显示 `* default  AK  LTAI****…`。
- 3. 探活：`workbench daemon status`（running）→ `workbench list ecs --region cn-shanghai --limit 10`（注意 `--limit` 下限 10，ECS API floor，传 5 报 code 2）。
-
- 日常操作：
-
- ```bash
- workbench list ecs --region cn-shanghai --limit 10
- workbench exec --instance-id i-uf6fm76cksm8ipd5mfjy --region cn-shanghai --command "ls -la /root/knowledgeroot"
- workbench upload ./local.md /root/knowledgeroot/<name>.md --instance-id i-uf6fm76cksm8ipd5mfjy --region cn-shanghai
- workbench download /root/knowledgeroot/<name>.md ./ --instance-id i-uf6fm76cksm8ipd5mfjy --region cn-shanghai
- ```

## 2. 内容边界

- 收录：可共同维护的知识正文、工作流步骤、适用条件及所需能力版本（Markdown 文本优先）。
- 不收录：Node/前端源码、二进制、`node_modules`、`.generated`、缓存、日志、State 数据、账号凭证与令牌。禁带口径与 `distribution-contract.md` §3/§3.1 一致。
- 现存的 `mp4`/`png` 为历史素材，原地保留；新增素材一律配一段同名或同目录 Markdown 说明其用途与适用工作流，不做无说明的裸媒体投递。

## 3. 目录与命名规则

- 新增文件名使用 kebab-case、无空格、无中文标点，例如 `causal-debug-checklist.md`。
- 同一主题的多文件用同名前缀归组（`<topic>-*.md` + `<topic>-assets/`），不建深层嵌套。
- 删除与覆盖是破坏性操作：Agent 上传前必须先 `exec ls -la` 确认目标是否存在；目标已存在时先告知用户再覆盖；删除必须经用户明确批准。

## 4. 人机共同维护

- Agent 侧写入流程固定为：`exec` 查存在 → 需要时告知覆盖影响 → `upload` → `exec` 回读校验。命令细节（`--instance-id` / `--region cn-shanghai` / `--limit 10-100` / `--output json`、upload 覆盖保护、destructive 命令先确认等）以 `.agents/skills/alibabacloud-workbench-cli/SKILL.md` 为准。不用交互式 `workbench config` 改凭证，不在仓库内持久化 AK/Secret。
- 仓库侧引用该目录时只记录稳定路径与条目名，不复制正文；`DOCUMENTS/` 与 `AGENTS.md` 不缓存其全文。`skills-lock.json` 当前只锁定飞书 skills，workbench skill 为 vendor 原文、无锁文件条目（后续如纳入统一锁机制再补）。
