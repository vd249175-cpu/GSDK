---
type: Developer Guide
title: 能力包打包、验证与安装规范
description: 遵循 GraphFramework 能力分发契约，使用 run.sh pack / verify / install 完成能力的确定性打包、安全红线审计、SHA-256 校验、沙箱冲突预演与安全安装更新。
status: stable
tags: [capability, packaging, verify, install, zip, conflict-resolution, distribution]
---

# 能力包打包、验证与安装规范

在 GraphFramework 中，能力包（Capability Package）是在团队成员与 Agent 之间分享可复用业务能力的官方制品载体。能力包是独立、无运行时依赖、确定性压缩的 ZIP 档案，由根目录统一命令工具提供全生命周期的打包、完整性审计、哈希校验与沙箱冲突预演。

---

# 1. 核心打包与安装命令体系

所有能力包与全局基础软件的打包、校验与安装操作必须通过根目录 `run.sh` 统一透传调用（底层由 `packages/tooling/run/src/package.mjs` 权威驱动）：

### 1.1 业务能力包（Capability Package）命令
```bash
# 1. 打包业务能力：将本地能力目录打包为确定性 ZIP 制品与同名 .sha256 校验文件
bash ./run.sh pack <capability-dir> [out.zip]

# 2. 校验能力包：在零执行沙箱中严格校验结构完整性、清单契约与 SHA-256 哈希
bash ./run.sh verify <capability.zip> [--expect-sha256 <hex>]

# 3. 安装或更新能力包：冲突预演后安全装配至目标 Run，支持首次安装或原位整体更新
bash ./run.sh install <capability.zip> [--dir <dir>] [--run <run.config.json>] [--update] [--expect-sha256 <hex>]
```


### 1.2 整 run 分享（Run Archive）命令
工作流分享以单个独立 run 为载体时（配置、非核心插件集合与测试一体），用整 run 打包代替能力包：
```bash
# 1. 打包整个 run 目录（排除 .generated / run.lock.json / node_modules，顶层为 <runName>/）
bash ./run.sh pack-run <run-dir> [out.zip]

# 2. 解压到目标目录的 runs/<runName>/ 下
bash ./run.sh install-run <run.zip> [target-base-dir]
```

### 1.3 全局基础软件更新包（Base Software Package）命令
```bash
# 1. 全局打包：一键生成包含全仓核心底座、核心插件、技能全集与 MCP 的全局更新包
bash ./run.sh pack-base [repo-root] [out.zip]

# 2. 全局安装：在全新目录或受管设备解压部署全局基础软件
bash ./run.sh install-base <base.zip> <target-dir>
```

> [!CAUTION]
> **严禁任何绕过 `run.sh` 的手动打包或第三方解压覆盖**：
> 手动解压或第三方 zip 压缩不仅会引入非确定性时间戳导致 SHA-256 校验失败，还会绕过运行时的目录防逃逸审计、凭据检查与拓扑冲突预演。

---

## 2. 能力包标准目录结构

一个合规的能力包必须自包含其业务装配声明与所需插件源码，目录结构严格如下：

```text
<capability-id>/
├── graphframework.capability.json   # 必填：能力元数据清单
├── assembly.mjs                     # 必填：能力包专属拓扑装配贡献模块
└── plugins/                         # 必填：插件源码目录
    ├── backend/<plugin-id>/         # 后端插件（保留 Manifest 与源码）
    │   ├── graphframework.plugin.json
    │   ├── PACKAGE.md
    │   ├── index.mjs                # manifest contributes.backend 指向的入口
    │   └── docs/INTEGRATION.md
    └── frontend/<plugin-id>/        # 前端插件（仅在包含 UI 时存在）
        ├── graphframework.plugin.json
        ├── PACKAGE.md
        └── index.html / src / ...
```

### 清单契约（`graphframework.capability.json`）

清单文件必须是合法的 JSON 对象，字段规范如下：

```json
{
  "id": "my-automation-capability",
  "version": "1.0.0",
  "minFrameworkVersion": "0.2.0",
  "summary": "提供自动化批量执行与物理世界反馈采集能力",
  "workflow": "https://ecs.your-server.com/knowledgeroot/workflows/batch-run.md"
}
```

- **`id`**（必填）：正则表达式必须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`；
- **`version`**（必填）：必须满足标准语义化版本 SemVer（例如 `1.0.0`）；
- **`minFrameworkVersion`**（可选）：最低兼容的 SDK / 框架版本；
- **`summary`**（可选）：能力的业务职责与用途简述；
- **`workflow`**（可选）：对应的工作流或知识库权威说明链接（通常指向阿里云自建云主机知识库）。

### 拓扑装配声明（`assembly.mjs`）

必须导出一个包含 `id` 和 `contribute(run)` 函数的对象。`id` 必须与 `capability.json` 中的 `id` 绝对一致：

```javascript
export default {
  id: 'my-automation-capability',
  contribute(run) {
    // 1. 注册后端插件（路径必须严格处于能力目录内部，防路径穿越）
    run.backendPlugin({
      id: 'my-automation-backend',
      path: './plugins/backend/my-automation-backend',
    });

    // 2. 准入 Node 节点实例（所引用的 factory 必须在对应 plugin manifest 中显式声明）
    run.node({
      id: 'automation.executor',
      plugin: 'my-automation-backend',
      factory: 'createAutomationNode',
    });

    // 3. 声明依赖的系统级公共 Node（由宿主提供，严禁打包进能力包）
    run.requireNode('system.timer');

    // 4. （可选）注册前端插件与面板
    // run.frontendPlugin({
    //   id: 'my-automation-frontend',
    //   path: './plugins/frontend/my-automation-frontend',
    // });
    // run.frontend({
    //   id: 'automation.panel',
    //   plugin: 'my-automation-frontend',
    // });
  },
};
```

---

## 3. 打包安全红线与严禁内容审计

在执行 `run.sh pack` 时，打包工具会执行严格的递归安全审查。若检测到任何违规文件，**打包将直接报错中止，绝不静默丢弃**：

### 绝对禁止打包的目录与文件（FORBIDDEN SEGMENTS & BASENAMES）

1. **构建与依赖产物**：
   - `node_modules`：任何第三方依赖必须在安装后由外层构建，不得打包源码级依赖包；
   - `.generated`：运行时生成的数据与缓存；
   - `.git` / `.hg` / `.svn`：版本控制元数据。
2. **私有凭据与敏感信息**：
   - `.env`、`daemon-token`、`control-token`、`control.json`、`environment.sh`；
   - 包含密钥、Token、私人密码的任何配置。
3. **运行时状态与锁文件**：
   - `run.lock.json`、`config-snapshot.json`、`close-result.json`；
   - 运行日志或 SQLite / 临时持久化状态文件。
4. **路径穿越防护**：
   - 严禁包含绝对路径或以 `..` 试图跳出能力目录的文件引用。

---

## 4. 确定性打包机制（Deterministic ZIP）

为了保证在不同操作系统（Windows / macOS / Linux）与不同时间点打包出的能力包具备**绝对一致的 SHA-256 哈希**，GraphFramework 实现了内置确定性 ZIP 生成算法：

1. **零外部依赖**：不依赖操作系统的 `zip` 命令行工具或第三方 npm 库，完全由原生 Node.js Buffer 与 CRC32 纯算法构建；
2. **固定 DOS 时间戳**：内部所有 ZIP 条目的最后修改时间强制固定为 `2020-01-01 00:00:00`（`dosTime = 0`, `dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1`）；
3. **固定存储模式（Stored Mode）**：条目采用无损 Stored 模式存储，消除不同 zlib 压缩算法实现的微小熵差异；
4. **标准正斜杠归一化**：所有路径归一化为相对正斜杠（`/`）格式，且根层级严格保持为单个顶层目录 `<capability-id>/`；
5. **配套 SHA-256 校验副产物**：自动生成 `<capability-id>-<version>.zip.sha256` 校验文件，格式为 `<hash>  <filename>`。

---

## 5. 能力发布标准全流程（Publisher Flow）

作为能力开发者或 Agent，发布一个新能力的完整标准步骤如下：

```text
Step 1: 本地沙箱装配与针对性测试跑通 (runs/<name>/)
  │
Step 2: 编写能力清单 (graphframework.capability.json) 与装配 (assembly.mjs)
  │
Step 3: 运行配置静态校验 (validate runs/<name>/run.config.json)
  │
Step 4: 执行确定性打包
  │     bash ./run.sh pack capabilities/<capability-id>
  │
Step 5: 获取产物与哈希
  │     输出: <capability-id>-<version>.zip 与 <capability-id>-<version>.zip.sha256
  │
Step 6: 在团队协作通道/知识库发布
        附带: 能力ID、版本号、摘要、最低框架版本、工作流链接、SHA-256
```

---

## 6. 能力接收、校验与冲突预演（Receiver Flow）

作为能力接收方，在将第三方或同事分享的能力包合并入自己的工作流时，必须经过以下严格守卫：

### 步骤 1：核对哈希与完整性校验（`run.sh verify`）

```bash
bash ./run.sh verify my-feature-1.0.0.zip --expect-sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

校验器将在系统临时目录中解压并执行以下验证：
- SHA-256 是否与预期完全一致；
- 压缩包是否只包含唯一的顶层目录 `<capability-id>`；
- 是否包含任何违禁目录、敏感凭据或运行时状态；
- `graphframework.capability.json` 是否合法，SemVer 是否有效；
- `assembly.mjs` 导出的 `contribution.id` 是否与能力清单一致；
- 所引用的后端/前端插件是否存在，`apiVersion` 是否为 2；
- 节点实例声明引用的工厂名称是否在插件清单中显式导出；
- 插件内的 `PACKAGE.md` ID 与版本号是否与插件清单一致。

### 步骤 2：冲突预演安装（`run.sh install`）

```bash
# 安装到专属开发 run 或 main run
bash ./run.sh install my-feature-1.0.0.zip --run runs/<your-name>/run.config.json
```

`install --run` 会在正式写入前拉起预演沙箱进行**冲突预演（Pre-flight Conflict Probe）**：
1. **拓扑重叠探测**：检查是否存在相同 ID 但来自不同路径的 Node、插件或前端面板；
2. **本地未提交修改保护**：如果本地已安装的该能力目录存在手工修改（Drift），工具将报警并拒绝覆盖；
3. **自动配置挂载**：
   - **首次安装**：自动在目标 `run.config.json` 的 `assembly.modules` 数组中追加该能力的相对装配路径；
   - **已有能力更新（`--update`）**：使用 `--update` 参数进行原位整体目录替换，不追加重复的 `assembly` 路径。

---

## 7. 冲突解决三选一准则

当安装预演报告存在拓扑冲突（例如同名 Node 已被其他能力注册）时，只允许以下三种解决方案，严禁绕过：

| 方案 | 适用场景 | 操作行为 |
| :--- | :--- | :--- |
| **1. 保留既有定义** | 本地已有版本是权威生产实现，新包冲突 | 终止安装，丢弃新能力包，保持本地定义不变。 |
| **2. 接受传入定义** | 确定新包是官方或更先进的升级版 | 增加 `--update` 参数执行原位整体替换（旧数据迁移遵循 Generation 因果断代语义）。 |
| **3. 新建扩展插件** | 两个能力都需要存在，但存在接口或实例重叠 | 在自己的扩展插件中（采用全新的插件与 Node ID），通过显式定向 `Info` 桥接协调两个能力。 |

> [!WARNING]
> **绝对红线**：
> 严禁直接修改正式插件目录内的源码，严禁静默覆盖其他 Node 的 Owner 权限。

---

## 8. 架构铁律：非核心插件不进入 `app/`

在安装或发布任何能力包与插件时，必须遵循全仓最高红线：

```text
app/                     <- 仅承载全仓最核心的底座架构与核心插件 (Core Plugins)
runs/<name>/capabilities/ <- 业务流程、自动化能力包安装目录
runs/<name>/plugins/      <- 开发者/Agent 专用的非核心插件开发沙箱
```

- **非核心插件绝对不进入 `app/`**；
- 业务工作流开发完成后，接收方在独立 run 沙箱中验证跑通测试；
- 验证无误后，工作流通过 `runs/main/capabilities/` 或 `runs/main/plugins/` 并入主 run，但**依然绝不进入核心 `app/`**。

---

## 9. 全局基础软件更新包（全局打包）包含清单

当执行 `bash ./run.sh pack-base` 进行全局基础软件制品打包时，打包器将自动归集完整的平台运行底座与交互工具链，确保接收方即使在完全空白的机器上解压后，**Agent 的电脑操作、浏览器操作、远程运维与微内核调度依然完整可用**：

| 分类 | 包含目录 / 文件 | 说明与作用 |
| :--- | :--- | :--- |
| **微内核与核心 Packages** | [`packages/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages) | 包含纯 Rust 微内核、多语言 SDK（TS/Python）、通用桌面宿主、达芬奇工作台、契约与工具链。 |
| **权威规范与参考知识** | [`REFERENCE/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE) & [`DOCUMENTS/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/DOCUMENTS) | 包含新版 REFERENCE 全部工程参考、心智模型、开发模式、分发规范及原备用参考。 |
| **官方核心插件全集** | [`app/plugins/*`](file:///c:/Users/kp157/Desktop/PM/GVSDK/app/plugins) | 全量 6 大官方核心插件：`unified-recorder`、`browser-recorder`、`os-recorder`、`ufo-computer-control`、`demo-topology`、`hello-counter`。 |
| **Agent 交互技能全集** | [`.agents/skills/*`](file:///c:/Users/kp157/Desktop/PM/GVSDK/.agents/skills) | 全量 Agent 技能：`alibabacloud-workbench-cli`（免公网云主机运维）、`browser-setup`、`gv-browser`（Playwright CLI 操作）、`ufo-computer-control`（Windows 桌面控制）、`graph-health-inspection`。 |
| **MCP 服务配置** | [`.omp/*`](file:///c:/Users/kp157/Desktop/PM/GVSDK/.omp) | 包含 `mcp.json`，确保 `chrome-devtools` 等 MCP 协议通道即插即用。 |
| **基准与模板沙箱** | `runs/alice/` & `runs/main/` | 提供新成员冷启动复制的基础模板以及主 run 生产集成入口配置。 |
| **根目录规范脚本** | `run.sh`、`AGENTS.md`、`README.md`、`LICENSE`、`.gitattributes`、`.gitignore`、`skills-lock.json` | 守卫运行入口与工程规范。 |

> [!CAUTION]
> **全局打包严格排除项（保证零环境污染与凭据安全）**：
> 1. **严禁包含凭据文件**：[`credentials.json`](file:///c:/Users/kp157/Desktop/PM/GVSDK/credentials.json)、`.env`、`daemon-token`、`control-token` 等敏感信息，由管理员线下独立安全分发；
> 2. **排除源码依赖与编译产物**：`node_modules/`、`target/`、`.git/`、`.generated/`、`.playwright-cli/`、`.playwright-mcp/`、`.test-temp/`；
> 3. **排除个人沙箱数据与日志**：`runs/*/run.lock.json`、`runs/*/.generated/`、`*.log`。

---

## 相关权威链接

- [冷启动与首次开发环境初始化指南](cold-start.md)
- [团队分发契约与协作策略](distribution-contract.md)
- [工作流三要素与生命周期](../workflow/workflow-elements-and-lifecycle.md)
- [测试规范与针对性验证](../testing-specification.md)
