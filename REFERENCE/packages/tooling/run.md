---
type: Developer Guide
title: 统一运行管理器与 CLI 操作全集 (packages/tooling/run)
description: 根目录 run.sh 底层引擎、CLI 子命令全集（start/status/stop/analyze/inspect/pack/install）与生命周期锁。
status: stable
tags: [tooling, run, cli, supervisor, lifecycle, distribution]
---

# 统一运行管理器与 CLI 操作全集 (`packages/tooling/run`)

源码目录：[`packages/tooling/run/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/tooling/run)  
入口文件：[`packages/tooling/run/src/cli.mjs`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/tooling/run/src/cli.mjs)

本包提供全仓的统一进程生命周期管理器、分发打包工具与实时控制命令集。

---

## 1. 唯一合法启动器：`run.sh` 核心命令

全仓所有功能必须通过根目录 `run.sh` 拉起，严禁绕过：

```bash
# 1. 启动命名 run（自动前置检查依赖、锁定 PID、预编译原生层、拉起守护进程与桌面宿主）
bash ./run.sh start runs/<name>/run.config.json

# 2. 查询当前 run 状态（实时探活 PID、心跳与微内核健康度）
bash ./run.sh status runs/<name>/run.config.json

# 3. 平稳停机（发送退出 Info、等待单飞结算完毕、释放 PID 锁、清空临时 IPC 句柄）
bash ./run.sh stop runs/<name>/run.config.json
```

---

## 2. CLI 高级运维与分析操作全集 (`cli.mjs`)

通过 `node packages/tooling/run/src/cli.mjs <command> <config-path>` 可直接向正在运行的 run 发起非侵入式运维指令：

| CLI 子命令 | 语法与参数 | 物理行为与返回 |
| :--- | :--- | :--- |
| **`status`** | `<run.config.json>` | 检查该 run 是否处于活跃态，探活 IPC 管道与返回微内核 PID。 |
| **`stop`** | `<run.config.json>` | 触发优雅停机协议。 |
| **`analyze`** | `<run.config.json> [requestJson]` | **直接对正在运行的图发起分析**。<br>默认执行 `{ "op": "health" }`，输出实时死锁与孤立节点报告。 |
| **`inspect`** | `<run.config.json> [optionsJson]` | **全息状态拉取**。读取当前状态投影、队列深度、活跃租约与事件环。 |
| **`validate`**| `<run.config.json>` | 校验 run 配置与 assembly 依赖是否完整、Rust 守护进程二进制是否存在。 |
| **`pack`** | `<pluginDir> <targetArchive>` | 将特定插件打包为分发包（含 SHA-256 签名）。 |
| **`verify`** | `<archive> [--expect-sha256 <hash>]` | 校验分发包的 SHA-256 完整性与签名。 |
| **`install`**| `<archive> --run <configPath>` | 将分发包解压并安装注册进指定 run 配置中。 |
| **`pack-run`**| `<runDir> <targetArchive>` | 导出整个命名 run（包含配置与专用插件集），用于团队共享与迁移。 |
| **`install-run`**| `<archive> <destDir>` | 导入并还原一个完整的独立 run 工作流。 |

---

## 3. 运行配置规范与路径隔离 (`run.config.json`)

```json
{
  "$schema": "https://graphframework.org/schemas/v2/run.config.json",
  "name": "my-scenario",
  "description": "自定义自动化场景",
  "plugins": [
    "./plugins/backend/custom-logic",
    "./plugins/frontend/custom-view"
  ],
  "assembly": "./assembly.mjs"
}
```

- **数据隔离原则**：该 run 启动产生的所有构建缓存、日志文件（`supervisor.log`）、套接字与锁文件均严格保存在 `runs/<name>/.generated/` 内部，运行完毕后可一键彻底清理，绝不污染系统全局。
