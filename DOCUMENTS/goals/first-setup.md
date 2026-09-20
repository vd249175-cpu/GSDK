---
type: Developer Guide
title: 第一次准备开发环境
description: 从零完成新成员电脑的环境探测、工具安装、仓库依赖构建、类型检查、创建独立 run 与首次启动验收。
status: stable
tags: [setup, onboarding, environment, build, first-run]
---

# 第一次准备开发环境

本指南面向首次接入 GraphFramework SDK 仓库的开发者。完成本流程后，你将拥有一套独立且合规的本地运行环境，并成功启动属于你自己的最小 run。

## 目标与完成标准

在新电脑上成功运行自己的最小 run 并通过环境验收。完整完成标准包含以下 6 项：

1. **基础工具齐全**：Git Bash（Windows）、Node.js、npm、Rust 工具链可用；
2. **仓库依赖就绪**：`packages/sdk/javascript` 与 `packages/desktop` 依赖安装完成，原生绑定编译且分发成功；
3. **类型检查通过**：两套 TypeScript 类型检查零错误；
4. **配置校验通过**：主 run 配置 `runs/main/run.config.json` 校验通过；
5. **独立 run 运行正常**：成功创建 `runs/<name>/`，并通过 `run.sh`（或 Windows `.cmd`）正常启动、查看状态并关闭；
6. **飞书身份可用**：已完成 `lark-cli` 安装与 `user-default` 授权（若需协同知识库与云盘）。

---

## 步骤 1：基础环境探测

在仓库根目录打开终端（Windows 必须使用 Git Bash），执行以下探测命令：

```bash
git --version
bash --version
node --version
npm --version
cargo --version
rustc --version
```

### 环境要求与注意项

- **Windows Git Bash**：
  - 必须提供可执行根目录 `run.sh` 的 Git Bash。
  - 如果 Git 已安装但 `bash` 不在系统 `PATH` 中，请先定位 Git for Windows 的实际 `bin` 目录（通常为 `C:\Program Files\Git\bin`）并追加到当前用户 `PATH`，然后重新开启终端检查。
  - **严禁**使用 PowerShell、WSL 或编写临时 Node 脚本绕过统一 run。
- **Node.js & npm**：建议使用 Node.js LTS 稳定版本（>= 18）。
- **Rust 工具链**：需要可用的 `cargo` 与 `rustc`（stable）。
- **依赖隔离**：根目录不设统一 npm workspace，各包使用独立锁文件管理依赖。

---

## 步骤 2：仓库依赖与首次构建

在仓库根目录依次执行以下命令，使用锁文件安装依赖并构建当前平台的 Rust 原生绑定：

```bash
# 1. 安装 JS/TS SDK 依赖
npm --prefix packages/sdk/javascript ci

# 2. 安装桌面宿主依赖
npm --prefix packages/desktop ci

# 3. 编译 Rust 原生内核节点绑定
cargo build --manifest-path packages/rust/Cargo.toml -p graphframework-kernel-node

# 4. 分发原生绑定至各宿主目录
node packages/rust/scripts/stage-native.mjs
node packages/rust/scripts/stage-backend-native.mjs

# 5. 构建桌面宿主与前端基座
npm --prefix packages/desktop run build
```

> [!NOTE]
> - 已有工作区只有在 lockfile 已确认且不会覆盖他人未保存环境时才重新执行 `npm ci`。
> - 其他工具包依赖按实际任务安装，不做无意义的全仓全量安装。

---

## 步骤 3：基础验证与类型检查

依赖构建完成后，先执行静态检查与配置校验，确保本地环境零隐患：

```bash
# 1. 桌面宿主类型检查
npm --prefix packages/desktop run typecheck

# 2. SDK 类型检查
npm --prefix packages/sdk/javascript run typecheck

# 3. 验证主 run 配置
node packages/tooling/run/src/cli.mjs validate runs/main/run.config.json
```

> [!IMPORTANT]
> 环境验收不等于盲目启动桌面应用。严禁为了验证安装而旁路拉起 Electron 或桌面窗口（如直接执行 `npx electron` 或修改 `packages/desktop/host/main.mjs`）。

---

## 步骤 4：创建你的独立 run

GraphFramework 采用命名 run 机制实现多开发者完全隔离。每位开发者拥有自己稳定命名的 `runs/<name>/` 目录：

1. 复制模板目录 `runs/alice/` 为 `runs/<your-name>/`（例如 `runs/bob/`）；
2. 修改 `runs/<your-name>/run.config.json`：
   - 将 `"name": "alice"` 修改为 `"name": "<your-name>"`；
   - 检查端口与资源配置，确保不与他人冲突；
3. 修改便捷脚本：
   - 更新 `runs/<your-name>/start.sh`、`stop.sh`、`status.sh`；
   - 更新 `runs/<your-name>/start.cmd`、`stop.cmd`、`status.cmd` 中的展示名称。

> [!NOTE]
> 便捷脚本必须遵循纯委托原则，严格透传根目录唯一的 `run.sh`（例如 `bash "$REPO_ROOT/run.sh" start "$CONFIG" "$@"`），严禁在脚本中编写旁路拉起逻辑。

---

## 步骤 5：启动、状态查看与平稳关闭

使用根目录统一规范入口启动你的 run：

### 使用 Bash 启动

```bash
# 校验配置
node packages/tooling/run/src/cli.mjs validate runs/<your-name>/run.config.json

# 启动 run
bash ./run.sh start runs/<your-name>/run.config.json

# 查看运行状态
bash ./run.sh status runs/<your-name>/run.config.json

# 平稳停止 run
bash ./run.sh stop runs/<your-name>/run.config.json
```

### Windows 用户便捷方式

Windows 环境下可直接双击或在命令行运行该目录下的便捷脚本：
- `runs/<your-name>/start.cmd`
- `runs/<your-name>/status.cmd`
- `runs/<your-name>/stop.cmd`

---

## 步骤 6：飞书 CLI 与用户身份初始化（协作推荐）

飞书承担团队知识库、工作流正文与能力 ZIP 分享通道。若需与团队成员协同，按以下流程初始化飞书工具链：

### 1. 安装飞书 CLI 与基础技能

```bash
npm install -g @larksuite/cli
npx -y skills add https://open.feishu.cn --skill -y
```

Windows 若找不到 `lark-cli`，先用 `npm prefix --global` 取得全局目录，并将其追加到当前用户 `PATH`，然后验证 `lark-cli --version`。

### 2. 绑定与授权

团队目标身份为 `user-default`，以本人身份维护知识库和访问云盘：

```bash
# 绑定团队应用凭证（Hermes 环境示例）
lark-cli config bind --source hermes --identity user-default

# 发起用户登录授权
lark-cli auth login --domain wiki --domain docs --domain drive --domain im --no-wait --json
```

在浏览器中确认授权后，执行验证：

```bash
lark-cli auth status --json --verify
```

确认输出中包含 `identity: user` 且 `verified: true`。

> [!CAUTION]
> 严禁把应用密钥、access token、个人凭证写入仓库文件、`AGENTS.md` 或提交记录中；device code 仅用于当次 split-flow 授权，不持久化。

---

## 下一步

- 开发你的第一个业务功能：[开发第一个业务功能](build-feature.md)
- 了解 run 的生命周期与架构守卫：[run 生命周期](../architecture/application-lifecycle.md)
- 多 Agent 独立运行契约：[多 Agent 协作指南](../contracts/multi-agent-run-guide.md)
