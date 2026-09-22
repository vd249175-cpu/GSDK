---
type: Developer Guide
title: 冷启动与首次开发环境初始化指南
description: 从零完成新成员与全新设备的基础工具探测、依赖安装、Rust 原生微内核绑定编译与分发、双工程 TypeScript 严格静态检查、独占 Run 沙箱建立与首次拉起验收。
status: stable
tags: [cold-start, onboarding, environment, native-build, run-sandbox, first-setup]
---

# 冷启动与首次开发环境初始化指南

本指南面向首次接入 GraphFramework SDK 仓库的开发者与 Agent。冷启动（Cold Start）是指在全新干净的机器或未初始化的工作区中，严格遵循架构规范与运行守卫，完成工具探测、依赖锁死、Rust 原生编译、静态类型防御，并建立独立且合规的本地运行沙箱。

完成本流程后，你将拥有一套独立且合规的本地运行环境，并成功启动属于你自己的最小 run。

---

## 1. 目标与完成标准

在新电脑上成功运行自己的最小 run 并通过环境验收。完整完成标准包含以下 5 项：

1. **基础工具齐全**：Git Bash（Windows）、Node.js（>= 18）、npm、Rust 工具链（stable `cargo` & `rustc`）可用；
2. **仓库依赖就绪**：`packages/sdk/javascript` 与 `packages/desktop` 依赖按 lockfile 安装完成，Rust 原生微内核绑定编译且分发成功；
3. **类型检查通过**：两套 TypeScript 类型检查零错误；
4. **配置校验通过**：主 run 配置 `runs/main/run.config.json` 静态校验通过；
5. **独立 run 运行正常**：成功创建独占的 `runs/<name>/` 沙箱，并通过根目录统一 `run.sh`（或 Windows `.cmd`）正常启动、查看状态并平稳关闭。

---

## 2. 步骤 1：基础环境探测

在仓库根目录打开终端（**Windows 必须使用 Git Bash**），执行以下探测命令：

```bash
git --version
bash --version
node --version
npm --version
cargo --version
rustc --version
```

### 环境要求与安全红线

- **Windows Git Bash**：
  - 必须提供可执行根目录 `run.sh` 的 Git Bash。
  - 如果 Git 已安装但 `bash` 不在系统 `PATH` 中，请先定位 Git for Windows 的实际 `bin` 目录（通常为 `C:\Program Files\Git\bin`）并追加到当前用户 `PATH`，然后重新开启终端检查。
  - **严禁**使用 PowerShell、WSL 或编写临时 Node 脚本绕过统一 run。
- **Node.js & npm**：建议使用 Node.js LTS 稳定版本（>= 18）。
- **Rust 工具链**：需要可用的 `cargo` 与 `rustc`（stable）。微内核调度执行由 Rust 承担，不可或缺。
- **依赖隔离**：根目录不设统一 npm workspace，各包使用独立锁文件管理依赖，防止全仓依赖混淆与隐式提升。

---

## 3. 步骤 2：仓库依赖与首次构建

在仓库根目录依次执行以下命令，使用锁文件安装依赖并构建当前平台的 Rust 原生绑定：

```bash
# 1. 安装 JS/TS SDK 依赖 (使用锁文件确保版本确定性)
npm --prefix packages/sdk/javascript ci

# 2. 安装桌面宿主依赖
npm --prefix packages/desktop ci

# 3. 编译 Rust 原生内核节点绑定
cargo build --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-node

# 4. 分发原生绑定至各宿主目录
node packages/rust/scripts/stage-native.mjs
node packages/rust/scripts/stage-backend-native.mjs

# 5. 构建桌面宿主与前端工作台基座
npm --prefix packages/desktop run build
```

> [!NOTE]
> - 已有工作区只有在 lockfile 已确认且不会覆盖他人未保存环境时才重新执行 `npm ci`。
> - 其他工具包依赖按实际任务安装，不做无意义的全仓全量安装。
> - `stage-native.mjs` 与 `stage-backend-native.mjs` 负责将编译生成的平台原生动态库复制到 SDK 与 Backend 所需的准确位置，缺此步骤将导致运行时无法装载内核。

---

## 4. 步骤 3：基础验证与双工程类型检查

依赖构建完成后，先执行静态检查与配置校验，确保本地环境零隐患：

```bash
# 1. 桌面宿主 TypeScript 严格检查
npm --prefix packages/desktop run typecheck

# 2. SDK TypeScript 严格检查
npm --prefix packages/sdk/javascript run typecheck

# 3. 静态验证主 run 配置合法性
node packages/tooling/run/src/cli.mjs validate runs/main/run.config.json
```

> [!IMPORTANT]
> **环境验收不等于盲目启动桌面应用**：
> 严禁为了验证安装而旁路拉起 Electron 或桌面窗口（如直接执行 `npx electron` 或修改 `packages/desktop/host/main.mjs`）。静态类型检查与 `validate` 命令足以在零副作用下完成环境验收。

---

## 5. 步骤 4：创建独占开发 Run 沙箱

GraphFramework 采用命名 run 机制实现多开发者完全隔离。每位开发者拥有自己稳定命名的 `runs/<name>/` 目录：

1. **复制模板目录**：
   复制模板目录 `runs/alice/` 为 `runs/<your-name>/`（例如 `runs/bob/`）：
   ```text
   runs/<your-name>/
   ├── assembly.mjs                 # 业务拓扑与实例装配声明
   ├── run.config.json              # 运行环境、端口与资源配置
   ├── start.sh / stop.sh / status.sh   # Bash 一键便捷脚本 (纯委托)
   └── start.cmd / stop.cmd / status.cmd # Windows 一键便捷脚本 (纯委托)
   ```

2. **修改 `runs/<your-name>/run.config.json`**：
   - 将 `"name": "alice"` 修改为 `"name": "<your-name>"`；
   - 检查端口与资源配置（例如 `kernel.daemon` 端口），确保不与他人或主 run 发生冲突。

3. **修改便捷脚本**：
   - 更新 `runs/<your-name>/start.sh`、`stop.sh`、`status.sh`；
   - 更新 `runs/<your-name>/start.cmd`、`stop.cmd`、`status.cmd` 中的展示名称。

> [!CAUTION]
> **便捷脚本纯委托原则（Pure Delegation）**：
> 便捷脚本必须遵循纯委托原则，严格透传根目录唯一的 `run.sh`（例如 `bash "$REPO_ROOT/run.sh" start "$CONFIG" "$@"`），严禁在脚本中编写旁路拉起逻辑。

> [!WARNING]
> **Windows `.cmd` 换行符硬性要求**：
> Windows `.cmd` 脚本必须为 **CRLF** 换行（仓库根目录 `.gitattributes` 已对 `runs/*/*.cmd` 强制 `eol=crlf`）。若被编辑器自动保存为 LF，会导致 `cmd.exe` 把中文与引号参数切碎，报 `config.json"` 或 `优雅停机` 异常。复制模板后若编辑器改了换行，请用 `git diff --check` 自查。

---

## 6. 步骤 5：启动、状态查看与平稳关闭

使用根目录统一规范入口启动你的 run：

### 使用 Git Bash 启动

```bash
# 1. 校验配置合法性
node packages/tooling/run/src/cli.mjs validate runs/<your-name>/run.config.json

# 2. 启动统一 run
bash ./run.sh start runs/<your-name>/run.config.json

# 3. 查看运行状态与微内核调度健康度
bash ./run.sh status runs/<your-name>/run.config.json

# 4. 平稳停止 run (关门禁、清在途、断观察、释租约、停内核)
bash ./run.sh stop runs/<your-name>/run.config.json
```

### Windows 用户一键便捷脚本

Windows 环境下可直接双击或在命令行运行该目录下的便捷脚本：
- `runs/<your-name>/start.cmd`
- `runs/<your-name>/status.cmd`
- `runs/<your-name>/stop.cmd`

---

## 7. 统一 Run 启动背后的 8 步因果推进全链路

当执行 `run.sh start` 时，底层由 `supervisor.sh` 严格按以下因果时序推进，不可跳步：

```text
Step 1. 配置校验与锁获取 (run.lock)
  │   - 校验 run.config.json、端口占用与文件系统边界，锁定独占锁
Step 2. 独占 Rust 微内核拉起 (kernel-daemon 进程)
  │   - 启动本地 Rust 进程，开启基于定向 Info 调度的微内核，监听私有通信通道
Step 3. 后端 Node 宿主就绪
  │   - 装载 assembly.mjs 声明的后端插件，准入 Node 实例，物理 EffectAdapter 认领外部硬件/环境
Step 4. 前端工作台构建
  │   - buildRunFrontends：Vite 编译前端插件达芬奇面板，esbuild 编译 host.mjs
Step 5. 桌面宿主拉起
  │   - Electron 启动并执行 host.mjs，安全注入 context.json (端口与令牌)
Step 6. 受控通信与达芬奇界面渲染
  │   - 建立只读 Projection 订阅与受限 Info 发送通道，渲染达芬奇专业调色盘风格主题工作台
Step 7. 界面布局与业务就绪
  │   - supervisor 验证健康度与几何可见性，注入并结算 lifecycle.startInfos 初始业务指令
Step 8. 对称平稳停机 (run.sh stop)
      - 关门禁 → 结算在途变迁 → 停止物理观察源 → 释放租约 → 停止微内核 → 退出进程
```

---

## 8. 冷启动常见问题与排错手册

| 故障现象 | 根本原因 | 处置方案 |
| :--- | :--- | :--- |
| `Cannot find module ... graphframework-kernel-node.node` | 未分发平台原生绑定 | 执行 `node packages/rust/scripts/stage-native.mjs` 与 `stage-backend-native.mjs` |
| `Launch a configured run from the repository root: bash ./run.sh ...` | 触发架构守卫（旁路拉起了 Electron） | 必须使用统一命令：`bash ./run.sh start runs/<name>/run.config.json` |
| Windows 执行 `.cmd` 报 `config.json"` 或乱码错位 | 换行符被转为 LF | 确保 `.cmd` 为 CRLF 换行；执行 `git checkout -- runs/<name>/*.cmd` 恢复 |
| `Kernel daemon port collision` 端口冲突 | 与现有其他 run 使用了相同端口 | 修改 `run.config.json` 中的私有通信端口号 |
| 无法通过 `typecheck` | 源码存在类型不兼容或未导出的符号 | 修复 TS 错误，严格满足微内核零业务语义与类型契约 |

---

## 相关权威链接

- [核心心智模型与架构红线](../architecture/mental-model.md)
- [测试规范与针对性验证](../testing-specification.md)
- [能力包打包、验证与安装规范](capability-packaging.md)
- [团队分发契约与协作策略](distribution-contract.md)
