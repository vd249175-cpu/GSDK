---
type: Contract
title: SDK、工作流与团队协作分发契约
description: 规定镜像 SDK、协作知识、工作流能力包分享、独立制品发布边界、版本兼容性、任意独立目录 7 步验收与性能标准的权威协作契约。
status: stable
tags: [distribution, contract, capability, collaboration, independent-acceptance, compatibility]
---

# SDK、工作流与团队协作分发契约

本契约规定 GraphFramework 正式交付与团队协作必须满足的硬性要求。目录职责以 [核心心智模型](../architecture/mental-model.md) 与 [架构约束](../architecture/development-constraints.md) 为最高准则；目录归位不等于制品已经通过独立发布验收。

---

## 1. 团队三层协作分发架构

团队协作内容按权责与物理边界严格划分为三个层级，各司其职，互不污染：

| 分发层级 | 分发载体 | 包含范围与权威内容 | 隔离边界与严禁项 |
| :--- | :--- | :--- | :--- |
| **1. 通用知识与工作流说明** | **阿里云云端知识库** (`/root/knowledgeroot`) | 可共同维护的业务规则、操作指引、开放平台 API 字段映射、工作流 SOP 及适用条件。 | 零本地代码绑定；本地仅保留访问索引与链接；严禁私有凭据。 |
| **2. 工作流场景分享** | **单个独立 Run (`runs/<name>/`) 或能力包 ZIP** | `run.config.json`、`assembly.mjs`、工作流专用非核心插件（位于 run 目录下）、针对性单测与集成测试用例。 | **非核心插件绝不进入 `app/`**；不携带内核源码、桌面宿主；严禁包含账号凭据与运行 State。 |
| **3. 基础软件更新 (全局打包)** | **团队批量更新通道 (`run.sh pack-base`)** | 全仓更新：`packages/`（微内核与多语言 SDK）、`REFERENCE/` & `DOCUMENTS/`、`app/`（全量 6 大官方核心插件）、`.agents/skills/`（Agent 技能全集）、`.omp/`（MCP 服务配置）、模板沙箱（`alice`/`main`）及根目录规约。 | 排除个人上下文、工作流专属插件、用户私有凭据（`credentials.json` 独立分发）、`node_modules`、编译产物与运行日志。 |

> [!IMPORTANT]
> **非核心插件不进入 `app/` 铁律**：
> - `app/` 与 `app/plugins/` 仅承载全仓最核心的底座与核心插件（例如系统级拓扑、通用基础节点）；
> - **所有非核心插件（业务流程、自动化策略、工作流专用节点）绝对不进入 `app/`**，只在对应 run 下的特定工作流中开发与装配（开发阶段在 `runs/<name>/plugins/`）；
> - **先跑通测试再并入 main**：工作流分享以单个独立 run 为完整沙箱，接收方必须在独立 run 中先跑通针对性测试与场景验证；验证通过后，工作流可通过 `runs/main/capabilities/` 或 `runs/main/plugins/` 并入主 run，但**非核心插件依然绝不进入核心 `app/`**。

---

## 2. 插件的正式交付形状

一个正式交付的插件必须具备自解释性、版本契约与测试覆盖，其目录形状严格如下：

```text
<plugin-id>/
├── graphframework.plugin.json   # 插件元数据清单 (apiVersion: 2)
├── PACKAGE.md                   # 遵循 OKF 0.2 的交付说明文档
├── index.mjs                    # 后端节点实现与工厂导出（manifest contributes.backend 指向的入口）
├── analysis/
│   └── folds.recommended.json   # 推荐折叠配置 (覆盖插件全部基础节点)
├── docs/
│   └── INTEGRATION.md           # 接入与拓扑集成指南
└── frontend/ desktop/           # (可选) 按实际业务 UI 接入需要提供
```

### 规范要求

- **`PACKAGE.md`**：必须遵循 OKF 0.2 知识包规范，记录插件职责、发布者、公开 Info/Projection、兼容版本、升级影响与破坏性变更摘要；
- **折叠推荐（`folds.recommended.json`）**：显式声明该插件基础 Node 在因果图分析中的推荐折叠深度，供宏观拓扑分析工具消费；
- **业务 UI 隔离**：无前端界面的后台业务插件不得伪造 UI；若有前端，遵循达芬奇调色盘色彩与单页面任意切分规范。

---

## 3. 同一工作流与能力的更新契约

### 3.1 稳定标识与不可变快照

- 工作流使用稳定的工作流 ID 与能力包 ID。
- 原工作流得到改进时，直接更新云端知识库中的对应条目版本与能力包版本；不得新建同名条目或把改进版伪装成全新的工作流。
- 能力包附件以 `<capability-id>-<version>.zip` 命名，每一个附件都是**不可变发布快照**；更新时发布新版本号文件并计算 SHA-256，旧文件保留在协作历史中仅用于审计与版本追溯。

### 3.2 因果断代（Generation）破坏性更新语义

更新能力包时，接收方执行：
```bash
bash ./run.sh install <capability-id>-<new-version>.zip --run runs/<name>/run.config.json --update
```

> [!CAUTION]
> **Generation 因果断代不是缺陷，而是刻意设计的安全机制**：
> - 运行时只在单飞（single-flight）间隙执行实例替换；
> - 替换时**丢弃旧 mailbox 积压消息，以新实例初始 State 干净启动，并使旧租约立即失效**；
> - 内核**严禁增加新版本失败自动回滚、State 自动继承/迁移或跨 generation 消息保留**；
> - 业务若需要保留持久化数据或迁移旧状态，必须由显式业务 Info 或外部存储协调完成，绝不依赖底座文件覆盖自动继承。

---

## 4. 独立目录发布验收（7 步标准演练）

为了证明能力包或 SDK 制品完全脱离 GVSDK 源码树后依然能独立运行，验收必须在一个**仓库外的完全干净目录**中进行：

```text
[Step 1] 安装所发布的 SDK、前端基座和目标平台 Rust 原生微内核制品 (不复制仓库 node_modules)
   │
[Step 2] 解压能力包或插件 ZIP，严格检查 Manifest、OKF PACKAGE.md、接入指南与 SHA-256
   │
[Step 3] 从任意独立目录启动准备好的 JS/Python Worker，在同一独立微内核 daemon 中通过定向 Info 协作
   │
[Step 4] 静态断言 State/version、定向 Info 发送、Effect 成功/失败/取消以及 Agent 审查语义
   │
[Step 5] 执行 Generation 替换演练，确认旧积压消息被刻意丢弃，State 干净重置，新版本失败不回滚
   │
[Step 6] 动态切换 foldDepth/folds，在 admit/replace/evict 生命周期中核对因果图分析快照更新
   │
[Step 7] （若包含前端）在独立宿主中核对 Projection 响应式投影、达芬奇色彩、页面分屏切分与拖出联动
```

只有完整通过上述 7 步独立目录演练的制品，才具备正式分发资格。

---

## 5. 性能与热冷路径分流判据

微内核与插件在分发前必须满足严苛的性能分流标准：

1. **执行热路径（Hot Path）极简**：
   - 热路径仅允许处理调度推进、State revision 递增与有界因果事件队列；
   - **绝对禁止**在热路径上执行图拓扑遍历、因果追踪解析或结构化算法；
2. **分析冷路径（Cold Path）按需一致**：
   - 因果图分析、中心度计算与拓扑健康检查仅在显式请求时，基于微内核只读快照独立计算；
   - 纯 State 值的变迁不得触发无关拓扑索引的重建；
   - 仅当 Node 增删、Generation 换代或字段集合改变时，才使相关分析缓存失效。

---

## 相关权威链接

- [冷启动与首次开发环境初始化指南](cold-start.md)
- [能力包打包、验证与安装规范](capability-packaging.md)
- [核心心智模型与架构红线](../architecture/mental-model.md)
- [测试规范与针对性验证](../testing-specification.md)
