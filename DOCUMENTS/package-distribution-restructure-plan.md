---
type: guide
title: 包分发阶段目录重构计划
description: 将开发期源码工作区重构为 app、plugins 和 packages 分发边界，并建立 JavaScript 与 Python SDK。
status: proposed
---

# 包分发阶段目录重构计划

## 1. 目标

仓库从源码直连开发阶段转入可独立构建、测试和分发的包阶段。重构后的目录必须让应用、业务插件、SDK 和 Rust 内核具有清晰的制品边界，使同事可以取得插件 ZIP、JavaScript 包、Python 包或原生运行时后，在任意工作目录接入，而不依赖本仓库的相对源码路径。

本计划只调整代码归属、构建入口和分发方式，不改变以下运行语义：

- Rust 微内核保持零业务语义；
- 所有业务能力都是同一种普通插件；
- Node 间只通过定向 Info 通信；
- State 只能由 Owner Node 在 change 中写入，可信 Agent 干预仍走独立控制面；
- 执行类和观察类 WorldNode 保持物理分离；
- Node generation 替换继续刻意丢弃旧 State 和 backlog，不增加回滚、迁移或无缝切换；
- Git、目录发现、编译器定位、安装和构建仍属于外层工具，不进入 Rust 内核。

## 2. 目标根目录

目标仓库的可见源码入口收敛为：

```text
GVSDK/
├─ app/                         GraphVideo 桌面应用与产品装配
├─ plugins/                     可独立交付的普通业务插件
├─ packages/                    SDK、Rust 运行时、工具与构建包
├─ DOCUMENTS/                   OKF 知识包、协议和接入文档
└─ AGENTS.md                    仓库开发守则
```

`.git/`、`.gitignore` 和 `LICENSE` 等版本管理或法律文件不属于源码目录边界，可以保留在根目录。根 `README.md` 的内容并入 `DOCUMENTS/README.md` 后删除。根目录不再保存应用源码、SDK 源码、Rust crate、工具源码、产品配置、构建脚本或编辑器配置。

各生态在自己的目录内拥有工作区清单和锁文件：

- 语言无关 SDK 契约位于 `packages/contract/`；
- JavaScript 与 Python 镜像 SDK 位于 `packages/sdk/`；
- JavaScript 专属前端能力位于 `packages/frontend/`；
- Cargo workspace 位于 `packages/rust/`；
- Electron 应用在 `app/` 内拥有自己的 `package.json`、锁文件和 Vite 配置。

这样根目录不再充当混合语言构建工作区。应用开发时通过已构建包、包管理器链接或明确的 `file:` 依赖消费 SDK，不再依靠跨越多层目录的源码 alias。

## 3. `packages/` 目标结构

```text
packages/
├─ contract/                   JS/Python 共用的唯一协议事实源
│  ├─ schemas/
│  ├─ golden-frames/
│  └─ compatibility/
├─ sdk/
│  ├─ javascript/
│  │  ├─ package.json
│  │  ├─ src/
│  │  │  ├─ protocol/
│  │  │  ├─ node/
│  │  │  ├─ effect/
│  │  │  ├─ plugin/
│  │  │  ├─ analysis/
│  │  │  ├─ agent/
│  │  │  └─ testing/
│  │  └─ tests/
│  └─ python/
│     ├─ pyproject.toml
│     ├─ src/graphvideo_sdk/
│     │  ├─ protocol/
│     │  ├─ node/
│     │  ├─ effect/
│     │  ├─ plugin/
│     │  ├─ analysis/
│     │  ├─ agent/
│     │  └─ testing/
│     └─ tests/
├─ frontend/                   JavaScript 专属，不属于跨语言 SDK 镜像
│  ├─ client/
│  ├─ workbench/
│  ├─ tokens/
│  └─ ui/
├─ rust/
│  ├─ Cargo.toml
│  ├─ Cargo.lock
│  ├─ kernel/
│  ├─ analysis/
│  ├─ kernel-daemon/
│  ├─ kernel-ffi/
│  └─ kernel-node/
└─ tooling/
   ├─ causal-visualizer/
   └─ release/                 分包、摘要、协议一致性和制品检查脚本
```

### 语言无关契约

`packages/contract` 是 JavaScript 和 Python SDK 的共同事实源，保存带版本的 JSON Schema、协议能力表、错误码、黄金帧和兼容矩阵。DTO 字段、operation 名称、generation、submission、分析请求和 Agent 控制面只能在这里定义一次。

Rust、JavaScript 和 Python 的测试都读取同一批黄金帧。任何跨语言能力先修改契约和 Rust 权威实现，再同时完成两套 SDK；不能先在一个 SDK 中长期形成私有能力。

### JavaScript 与 Python 镜像 SDK

JavaScript SDK 和 Python SDK 是同一能力面的两种语言适配，目录和公开概念一一对应：

| 能力面 | JavaScript | Python | 共同语义 |
| :--- | :--- | :--- | :--- |
| `protocol` | TypeScript DTO | Python DTO/model | JSON 字段、版本和错误码完全一致 |
| `node` | Node、change context、daemon worker | Node、change context、daemon worker | State Owner、single-flight、send、generation 一致 |
| `effect` | Effect provider/client | Effect provider/client | Request、Observation、能力绑定和取消一致 |
| `plugin` | Manifest、插件工厂和包校验 | Manifest、插件工厂和包校验 | 同一个普通插件模型与 OKF 契约 |
| `analysis` | 便携事实与分析客户端 | 便携事实与分析客户端 | 相同 operation、foldDepth、folds 和结果 DTO |
| `agent` | inspect/analyze/inject/patch | inspect/analyze/inject/patch | 相同权限、版本校验和审计字段 |
| `testing` | Node/协议测试工具 | Node/协议测试工具 | 相同输入、收敛条件和断言语义 |

传输适配可以不同：JavaScript 可使用 N-API 或 daemon，Python 可使用 daemon 或 C ABI；Promise 和 Python async 使用各自语言习惯。线上的 DTO 字段、行为、错误和生命周期不能不同。每个跨语言公开能力只有在 JavaScript 与 Python 两侧都实现并通过共同契约测试后才算完成。

当前 `core/`、`sdk/backend/`、`sdk/analysis/`、`sdk/testing/` 和通用 contract 内容需要按上述能力面归入 JavaScript SDK，而不是原样保留三个历史 npm 包。迁移完成后以一个权威 JavaScript SDK 包及其子路径发布；现有 `@graphvideo/kernel`、`@graphvideo/backend-sdk` 与 `@graphvideo/sdk/backend` 的消费者统一迁移到新入口，旧入口在切换提交中删除，不形成长期兼容层。

两套 SDK 都不负责 Git 拉取、虚拟环境创建、依赖安装、编译器定位或进程守护，也都不复制 Rust 调度或分析算法。

### JavaScript 专属前端包

现有 `client`、`workbench`、`tokens` 和 `ui` 使用浏览器、React 与 Electron 能力，没有 Python 对应物，因此从镜像 SDK 中移入 `packages/frontend`。前端包可以依赖 JavaScript SDK 的 protocol、agent 和 analysis 公开入口，但不反向改变跨语言 SDK 契约。

插件后端无论用 JavaScript 还是 Python 都遵守相同 Node/Info/State 协议；只有需要用户操作的插件才额外消费 frontend 包贡献 Element 或 Workspace。

### Rust 包

当前 `crates/*` 原样归入 `packages/rust/*`，crate 名称和职责不变：

- `graphvideo-kernel`：mailbox、generation、single-flight、submission 与替换；
- `graphvideo-analysis`：语言无关的动态因果分析、折叠和结构指标；
- `graphvideo-kernel-daemon`：常驻规则空间和语言无关 JSON Lines 宿主；
- `graphvideo-kernel-ffi`：稳定 C ABI；
- `graphvideo-kernel-node`：N-API 绑定。

Cargo workspace、构建目标和原生制品暂存全部位于 `packages/rust/`。Rust crate 不得依赖 `app/`、`plugins/`、JavaScript SDK 或 Python SDK。

## 4. 应用与插件边界

`apps/local-app` 迁为 `app/`。它只保留 Electron 生命周期、renderer、主进程物理宿主、产品级插件装配、应用资源和应用测试。

`apps/local-app/plugins/*` 全部提升到根 `plugins/*`。每个目录都是可以独立压缩和发布的普通插件：

```text
plugins/<plugin-id>/
├─ graphvideo.plugin.json
├─ PACKAGE.md                  OKF 包说明和发布者所有权
├─ backend.ts|mjs
├─ analysis/
│  └─ folds.recommended.json
├─ docs/
│  └─ INTEGRATION.md
├─ elements/                   仅需要用户操作时存在
└─ workspaces/                 仅需要前端工作区时存在
```

`graphvideo.studio` 当前从 `app/src-main` 和 `app/renderer` 深层导入大量业务实现。提升前必须先把属于插件的 Node、协议、Element 和领域代码收回插件目录，把真正的 Electron、文件系统、数据库、进程和窗口能力留在 `app/`，通过构造注入的 Adapter 或公开宿主依赖连接。插件不能通过相对路径导入另一个插件或应用内部文件。

应用产品配置维护明确的插件允许列表与入口路径。迁移阶段仍采用显式装配，不引入隐式全目录扫描；插件 ZIP 的发现、解压、校验和安装属于以后可选的外层分发工具。

正式插件的所有权、禁止污染、独立插件扩展和前端条件继续遵守[插件发布与协作契约](./plugin-collaboration-contract.md)。

## 5. 现有目录迁移表

| 当前路径 | 目标路径 | 处理方式 |
| :--- | :--- | :--- |
| `core/src/` | `packages/sdk/javascript/src/node/` 与 `testing/` | 拆分 Node 公共 API 和 TS 测试 Oracle，归入镜像能力面 |
| `sdk/backend/` | `packages/sdk/javascript/src/{node,effect,plugin,agent}/` | 按公开能力归位，不保留嵌套 npm 包 |
| `sdk/analysis/` | `packages/sdk/javascript/src/analysis/` | 只保留事实适配与客户端，Rust 继续权威计算 |
| `sdk/testing/` | `packages/sdk/javascript/src/testing/` | 与 Python testing 使用共同验收语义 |
| `sdk/contract/` | `packages/contract/` 与 JS `protocol/` | 语言无关 schema 上收，生成或适配的 TS 类型留在 JS SDK |
| `sdk/client/`、`sdk/workbench/`、`sdk/tokens/`、`sdk/ui/` | `packages/frontend/*` | 与 Python 无镜像关系的浏览器能力独立发布 |
| `sdk/type-tests/` | `packages/sdk/javascript/tests/` | 迁为 JavaScript SDK 公共 API 契约测试 |
| `crates/*` | `packages/rust/*` | 整体迁移并更新 Cargo path |
| `tools/causal-visualizer/` | `packages/tooling/causal-visualizer/` | 作为开发工具包，不进入应用制品 |
| `scripts/*` | `packages/*/scripts` 或 `app/scripts/` | 按实际所有者拆分，不保留通用根脚本箱 |
| `apps/local-app/` | `app/` | 移动应用并改为消费发布包入口 |
| `apps/local-app/plugins/*` | `plugins/*` | 先消除对 app 内部源码的反向依赖，再提升 |
| `products/studio.json` | `app/products/studio.json` | 产品装配属于应用 |
| 根 Vite/TS 配置 | `packages/sdk/javascript/`、`packages/frontend/` 或 `app/` | 各工作区独立持有 |
| `.env.example` | `app/.env.example` | 环境变量属于具体宿主 |
| 启动批处理 | `app/scripts/` | 只启动应用，不承担 SDK 构建 |
| `.agents/skills/` | `DOCUMENTS/agent-guides/` 或对应 tooling 包 | 保留知识，移除根级源码目录 |
| `.vscode/` | 删除或放入非分发的个人环境 | 不作为 SDK 制品内容 |

所有移动使用 `git mv` 并在同一个原子提交中更新 import、package exports、测试配置和构建脚本。主分支不保留旧目录 re-export、复制源码或双路径兼容层。

## 6. 依赖方向

重构后的允许依赖为：

```text
plugins ───────────► JavaScript/Python 镜像 SDK 公开接口
app ───────────────► plugins + frontend + JavaScript SDK + Rust 分发制品
frontend ──────────► JavaScript SDK 的 protocol/agent/analysis
JavaScript SDK ────► contract + Rust N-API/daemon DTO
Python SDK ────────► contract + Rust daemon/C ABI DTO
Rust adapters ────► contract + Rust kernel + Rust analysis
Rust kernel ──────► 标准库/通用基础依赖
```

禁止方向为：

- `packages/**` 导入 `app/**` 或 `plugins/**`；
- 一个插件导入另一个插件的内部源码；
- 插件导入 `app/**` 内部源码；
- Rust 内核依赖任何语言 SDK；
- frontend 能力进入 Python SDK，或反向定义 Node/分析协议；
- JavaScript 或 Python 出现另一侧没有对应项的长期公开 SDK 能力；
- JavaScript 与 Python SDK 复制 Rust 分析算法或调度状态机；
- app 通过源码 alias 绕过包 exports。

## 7. 分阶段实施

### 阶段 0：冻结与基线

1. 冻结新的根级目录和跨包相对导入。
2. 记录当前 npm exports、Cargo ABI、daemon 协议、插件清单和应用入口。
3. 建立现有 Rust、TypeScript、Electron、进程 Node、Agent 与分析测试基线。
4. 增加依赖方向检查，先报告现有违规，不立即隐藏问题。

验收：工作树干净；当前测试基线可重复；所有跨边界相对导入都有归属清单。

### 阶段 1：建立包工作区

1. 创建 `packages/contract`、`packages/sdk`、`packages/frontend`、`packages/rust` 和 `packages/tooling`。
2. 从当前 Rust/JS DTO 和测试提取版本化 schema、错误码、能力表和黄金帧。
3. 移动 Rust workspace，更新 Cargo path、N-API 暂存位置和构建脚本。
4. 让 Rust daemon、C ABI 和 N-API 共同通过 contract 黄金帧。

验收：Rust workspace 测试和 Clippy 通过；contract 中的每个 operation 都有 schema 与黄金帧；Rust 三个入口返回一致 DTO；旧 `crates/` 不再存在。

### 阶段 2：建立镜像 SDK

1. 按 `protocol/node/effect/plugin/analysis/agent/testing` 把现有 JS 能力迁入 `packages/sdk/javascript`。
2. 每迁入一个 JS 能力面，同步在 `packages/sdk/python` 实现对应 API，不把 Python 留到最后补齐。
3. 把 React、Client、Workbench、Token 和 UI 从 SDK 移到 `packages/frontend`。
4. 建立一份镜像能力矩阵，逐项核对 DTO、行为、错误、取消、generation 和测试语义。
5. 让两套 SDK 对同一个 Rust daemon 运行相同黄金用例和跨语言 Node 用例。
6. 构建一个权威 JavaScript SDK npm tarball、Python wheel/sdist 和独立 frontend 制品。
7. 迁移仓库消费者到新入口，并在同一切换提交中删除旧 npm 包与重复 exports。

验收：镜像能力矩阵没有缺项；Python Node 与 JavaScript Node 可以在同一规则空间通过 Info 协作；两者的执行、分析和 Agent 结果 DTO 一致；npm 包和 wheel 都不包含编译器或业务代码；旧 `core/`、`sdk/` 不再存在。

### 阶段 3：拆分 app 与 plugins

1. 把 `graphvideo.studio` 的业务 Node、协议和前端贡献收回自己的插件目录。
2. 把 Electron、文件、数据库、进程和窗口 Adapter 留在 app 并通过构造依赖注入。
3. 将所有插件提升到根 `plugins/`，补齐 `PACKAGE.md`、接入指南和折叠建议。
4. 修改 app 的显式产品装配，从根插件目录或已安装插件制品加载。
5. 删除插件到 app 内部源码、插件到插件内部源码的相对导入。

验收：每个插件可以独立打 ZIP；正式插件完整性可校验；同事插件可以仅依赖公开 Info 接入；app 不拥有业务 Node 实现。

### 阶段 4：工具归位与根目录收口

1. 把 release、stage、benchmark、协议检查脚本移动到其所有者包。
2. 把 causal visualizer 移到 tooling。
3. 把产品配置、环境样例、启动脚本和应用构建配置移入 app。
4. 合并根 README 到 OKF 导航，清理 `.vscode` 和无归属文件。
5. 删除所有过渡 alias、旧路径和重复配置。

验收：除版本控制和法律文件外，根级源码只剩 `app/`、`plugins/`、`packages/`、`DOCUMENTS/` 和 `AGENTS.md`。

### 阶段 5：分发演练

在一个不位于仓库内的空目录执行完整演练：

1. 安装 npm tarball、Python wheel 和目标平台 Rust daemon/N-API 制品；
2. 解压一个正式插件 ZIP 并核对 OKF、Manifest 和 SHA-256；
3. 启动 daemon，分别接入 JavaScript Node 与 Python Node；
4. 验证 Info、State、Effect、Agent inspect/inject/patch 和动态分析；
5. 按 generation 规则替换插件版本，确认旧 backlog 和 State 被刻意丢弃；
6. 启动 app 并验证显式插件装配、Projection 和可选达芬奇前端。

验收：演练不读取 GVSDK 源码路径，不需要复制 `node_modules`，不要求插件位于固定目录，所有制品均能根据自身接入指南独立使用。

## 8. 发布制品

完成重构后，每次发布至少产生：

| 制品 | 格式 |
| :--- | :--- |
| JavaScript 镜像 SDK | `@graphvideo/sdk` npm `.tgz`，按能力面提供子路径 |
| Python 镜像 SDK | `graphvideo-sdk` wheel + sdist，提供对应模块 |
| JavaScript frontend | 一个或多个 npm `.tgz`，不计入镜像能力面 |
| 语言无关 contract | schema、黄金帧、能力矩阵与版本清单 |
| Rust daemon | 各目标平台可执行文件压缩包 |
| Rust C ABI | 动态库、头文件、协议版本和示例 |
| Rust N-API | 按平台命名的 `.node` 制品 |
| 普通业务插件 | 含 OKF 与接入指南的版本化 ZIP |
| GraphVideo app | Electron 平台安装包 |

每个制品拥有独立版本、摘要和内容清单。发布清单记录 JS SDK、Python SDK、daemon、ABI、N-API 和 app 的兼容矩阵；插件只声明其实际使用的最低协议和 SDK 版本。

## 9. 风险控制

- **深层相对导入**：先按所有权迁移源码，再移动目录；不能用长期 alias 掩盖边界错误。
- **历史 npm 边界**：以镜像能力面重组 JS SDK，迁移消费者后一次删除旧包名和重复 exports，不让历史目录决定新协议。
- **原生制品定位**：只通过包内平台映射定位 N-API，不读取仓库 `target/`。
- **插件自包含性不足**：优先处理 `graphvideo.studio` 对 app 内部实现的反向依赖。
- **镜像能力漂移**：每个能力用 contract 黄金帧同时验收 JS/Python，任一侧缺失即阻止发布。
- **一次性大迁移**：每阶段使用独立、可验证的 `git mv` 提交，阶段结束立即删除旧路径。
- **文档提前宣称完成**：本文件在重构完成前保持 `status: proposed`；当前事实文档只在对应阶段通过后更新。

## 10. 完成定义

以下条件全部满足后，目录重构才算完成：

1. 根级源码布局符合目标结构，没有 `core/`、`sdk/`、`crates/`、`apps/`、`tools/`、`products/` 或 `scripts/`；
2. app、插件、JavaScript SDK、Python SDK、frontend 和 Rust workspace 可以分别构建；
3. app 和插件只从正式包 exports 导入 SDK；
4. JavaScript 与 Python SDK 的七个能力面一一对应，并通过同一 Rust 执行、分析和 Agent 协议工作；
5. Rust 热路径性能基线没有因目录和分包变化退化；
6. 任意目录安装测试、跨语言测试、动态分析、Agent 控制和插件 ZIP 演练通过；
7. 插件协作契约、SDK 接入指南和发布清单与最终目录一致；
8. 工作树干净，旧路径、过渡兼容层和重复源码全部删除。
