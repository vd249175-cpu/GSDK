---
type: Catalog
title: 冷启动与能力包分发规范总览
description: GraphFramework 本地环境冷启动、独占 Run 初始化、能力包确定性打包、安全红线审查、SHA-256 校验、冲突预演与团队三层分发契约的权威目录总索引。
status: stable
tags: [distribution, cold-start, packaging, lifecycle, index]
---

# 冷启动与能力包分发规范总览

本目录汇总了 GraphFramework SDK 在**开发者/设备冷启动（Cold Start）**与**业务能力打包分发（Capability Packaging & Distribution）**两个核心维度的所有权威标准、实操指引与契约约束。

无论是新成员首次配置环境并启动最小 run，还是资深开发者将已跑通的工作流封装为确定性 ZIP 制品发布给团队，必须严格遵照本目录下的文档指引。

---

## 1. 核心导航与文档索引

| 阶段 / 任务 | 权威文档 | 核心内容与操作 |
| :--- | :--- | :--- |
| **首次环境与冷启动** | [冷启动与首次开发环境初始化指南](cold-start.md) | 从零完成 Windows Git Bash、Node.js、Rust 工具链探测；依赖安装与 Rust 原生绑定编译；双工程严格 TypeScript 校验；复制并配置独占的 `runs/<name>/` 沙箱；通过根目录统一 `run.sh` 首次拉起并验证 8 步因果生命周期。 |
| **能力包打包与实操** | [能力包打包、验证与安装规范](capability-packaging.md) | 统一三命令实操（`run.sh pack / verify / install`）；标准能力目录规范（`capability.json` + `assembly.mjs` + `plugins/`）；固定时间戳与存储模式的**确定性 ZIP 机制**；打包安全红线（严禁包含凭据、`node_modules`、运行状态）；安装前沙箱冲突预演与**三选一解决准则**。 |
| **团队分发与架构契约** | [SDK、工作流与团队协作分发契约](distribution-contract.md) | **团队三层协作分发架构**（阿里云自建云主机知识库、独立 Run 场景分享、基础软件批量更新通道）；**非核心插件绝对不进入 `app/` 铁律**；插件正式交付标准形态；Generation 因果断代破坏性更新语义；脱离 GVSDK 源码树的**独立目录 7 步发布验收标准**；执行热路径与分析冷路径性能分流准则。 |

---

## 2. 冷启动与打包生命周期全景图

```text
               【开发者 / 设备冷启动】(cold-start.md)
                         │
        1. 基础工具探测 (Git Bash / Node / Rust)
                         │
        2. 依赖安装与 Rust 微内核绑定编译 (cargo build + stage)
                         │
        3. 双工程 TypeScript 类型检查 (零容忍静态报错)
                         │
        4. 复制创建独占开发 Run (runs/<name>/)
                         │
        5. 首次拉起验收 (run.sh start / status / stop)
                         │
                         ▼
               【业务开发与工作流验证】(workflow/ / plugins/)
                         │
        - 编写专用节点与工作流拓扑
        - 本地独立 run 跑通场景与单测
                         │
                         ▼
             【能力打包与安全发布】(capability-packaging.md)
                         │
        1. 编写 capability.json 与 assembly.mjs
        2. 审查排除凭据、node_modules、.generated
        3. 确定性打包: bash ./run.sh pack capabilities/<id>
        4. 获取不可变 ZIP 产物与 SHA-256 校验值
                         │
                         ▼
             【团队协作与安全安装】(distribution-contract.md)
                         │
        1. 知识库记录工作流 SOP (阿里云云端 /root/knowledgeroot)
        2. 协作通道传输能力包 ZIP 与 SHA-256
        3. 接收方校验: bash ./run.sh verify <cap.zip>
        4. 冲突预演安装: bash ./run.sh install <cap.zip> --run runs/<name>/run.config.json
        5. 解决冲突 (保留原定义 / --update 原位替换 / 扩展插件桥接)
        6. 验证无误后并入 runs/main (非核心插件依然绝不进入 app/)
```

---

## 3. 必须坚守的五大底线守则

1. **唯一合法启动命令**：全仓唯一合法的拉起命令为 `bash ./run.sh start runs/<name>/run.config.json`；任何绕过统一 run 的旁路拉起（如 `npx electron`、临时 Node 脚本）均为严重违规。
2. **便捷脚本纯委托**：`runs/<name>/` 下的 `.sh` 与 Windows `.cmd` 必须保持纯委托原则，严禁编写旁路拉起逻辑；Windows `.cmd` 必须为 CRLF 换行。
3. **非核心插件不进入 `app/` 铁律**：`app/` 与 `app/plugins/` 仅承载全仓最核心的底座与核心插件；所有业务工作流与专用能力只存在于 run 目录或能力包中，绝不污染核心 `app/`。
4. **打包安全红线**：能力包严禁包含 `node_modules`、`.generated`、私有凭据（`.env`、token 等）或运行状态文件。打包器检测到违规将直接报错中止。
5. **确定性制品与哈希一致**：打包机制强制使用固定 DOS 时间戳与 Stored 模式，确保相同源码在任何环境打包生成的 SHA-256 绝对一致，杜绝分发篡改与环境熵污染。

---

## 相关上级索引

- [GraphFramework SDK 开发手册与核心模式总索引](../README.md)
- [核心开发模式](../core-development-mode.md)
- [工作流开发模式](../workflow-development-mode.md)
- [测试规范与针对性验证](../testing-specification.md)
