---
type: Developer Guide
title: 打包、安装或更新能力
description: 遵循能力分发契约，使用 run.sh pack / verify / install 完成能力的确定性打包、安全校验、冲突预演与安装更新。
status: stable
tags: [capability, packaging, distribution, install, conflict-resolution]
---

# 打包、安装或更新能力

GraphFramework 采用能力包（Capability Package）机制在团队成员与 Agent 之间安全分享可复用的业务能力。能力包是独立、无运行时依赖、确定性压缩的 ZIP 档案，支持飞书知识库与群聊分享。

---

## 三个唯一打包与安装命令

所有打包、校验与安装操作全部通过根目录 `run.sh` 统一透传：

```bash
# 1. 打包能力
bash ./run.sh pack <capability-dir> [out.zip]

# 2. 校验能力包完整性与 SHA-256
bash ./run.sh verify <capability.zip> [--expect-sha256 <hex>]

# 3. 安装或更新能力包至指定 run
bash ./run.sh install <capability.zip> [--dir <dir>] [--run <run.config.json>] [--update] [--expect-sha256 <hex>]
```

---

## 制品发布与分发打包层级

系统遵循明确的制品发布与分发打包层级：

| 分发层级 | 分发内容与载体 | 包含范围 | 边界与隔离规则 |
| :--- | :--- | :--- | :--- |
| **基础软件更新包** | 全面更新（批量通道） | `packages/` + `DOCUMENTS/` + `app/`（含 `app/plugins/` 核心插件） | 仅更新核心底座与核心插件；排除个人上下文、工作流与非核心插件 |
| **工作流场景分享** | 单个独立 Run (`runs/<name>/`) + 飞书文本说明 + 针对性测试 | `run.config.json`、`assembly.mjs`、专用的非核心插件集合（位于 run 下）、单测用例 | **非核心插件不进入 `app/`**，先在独立 run 中跑通测试再并入 `runs/main/plugins/` |
| **能力包 ZIP** | `<capability-id>-<version>.zip` + SHA-256 | 清单文件、专属 `assembly.mjs`、插件源码目录 | 安装到目标 run 下，不污染核心 `app/` |

> [!IMPORTANT]
> **非核心插件不进入 `app/` 铁律**：
> - `app/` 与 `app/plugins/` 仅承载全仓最核心的底座与核心插件；
> - **所有非核心插件（业务流程、自动化策略、工作流专用节点）绝对不进入 `app/`**，只在 run 下的特定工作流中（开发阶段在 `runs/<name>/plugins/`）；
> - **先跑通测试再并入 main**：工作流分享以单个完整 run 为沙箱，接收方必须在独立 run 中先跑通针对性测试与场景验证；验证通过后，工作流可通过 `runs/main/plugins/` 并入主 run，但**非核心插件依然绝不进入核心 `app/`**。

---

## 能力包目录标准结构

能力包根目录下必须包含清单文件与自包含装配声明：

```text
<capability-id>/
├─ graphframework.capability.json   # 能力元数据清单
├─ assembly.mjs                     # 能力包专属拓扑装配
├─ plugins/
│  ├─ backend/<plugin-id>/          # 后端插件（保留 Manifest 与源码）
│  └─ frontend/<plugin-id>/         # 前端插件（仅在包含 UI 时存在）
```

> [!CAUTION]
> **打包安全红线**：能力包内**严禁**包含 `node_modules`、`.generated`、个人凭证、State 数据或运行日志。若 `pack` 检测到这些内容，将直接报错中止，不会静默丢弃。

---

## 能力发布标准流程

1. **装配验证先行**：在打包前，先在一个临时 run 中引入该能力的 `assembly.mjs`，执行 `node packages/tooling/run/src/cli.mjs validate` 确保无装配冲突。
2. **确定性打包**：
   ```bash
   bash ./run.sh pack capabilities/my-feature
   ```
   工具将生成 `<capability-id>-<version>.zip` 及同名 `.sha256` 校验文件。打包采用固定 DOS 时间戳与 Stored ZIP 模式，相同内容打包的 SHA-256 绝对一致。
3. **协作群发布规范**：在群内分享时，必须同步附带：
   - 能力包 ID 与版本号；
   - 用途与变更摘要；
   - 最低兼容的 GraphFramework 框架版本；
   - 对应的飞书工作流链接；
   - 官方生成的 SHA-256 哈希值。

---

## 能力接收与安装流程

1. **来源可信与校验**：只接收来自团队可信成员的能力包，接收后先核对哈希与结构：
   ```bash
   bash ./run.sh verify my-feature-1.0.0.zip --expect-sha256 <hex>
   ```
2. **冲突预演安装**：
   ```bash
   bash ./run.sh install my-feature-1.0.0.zip --run runs/<your-name>/run.config.json
   ```
   `install --run` 会先在临时目录进行冲突预演：
   - 若检测到同 ID 但不同路径的插件、冲突的实例或前端定义，将明确提示 `conflicting ...` 并同时展示既有与传入定义；此时本地 run 配置与已装能力保持不动。
   - 若本地已安装的能力被手工修改过，将提示存在本地编辑并拒绝静默覆盖。
3. **首次安装 vs 更新**：
   - **首次安装**：自动在 `run.config.json` 的 `assembly.modules` 中追加一条该能力的 `assembly.mjs`。
   - **已有能力更新**：使用 `--update` 参数原位整体替换能力目录，不追加第二条 `assembly`。
4. **启动验证**：安装完成后，先执行 `validate`，再通过 `run.sh start` 启动。

---

## 冲突解决三选一准则

当安装发生冲突时，只允许以下三种解决方案，严禁绕过：

1. **保留既有定义**：放弃安装新包，维持本地现有能力与定义。
2. **接受传入定义**：使用 `--update` 进行原位整体替换（旧数据迁移遵照 generation 断代语义）。
3. **新建扩展插件**：在自己的扩展插件中（使用新插件 ID），通过定向 Info 桥接两个能力。

> [!WARNING]
> 严禁直接修改正式插件目录内的文件，严禁静默覆盖其他 Node 的 Owner。

---

## 下一步

- 查阅完整分发契约与性能指标：[SDK、插件与飞书协作分发契约](../contracts/distribution-contract.md)
- 查阅插件协作与所有权边界：[插件发布与协作契约](../contracts/plugin-collaboration-contract.md)
