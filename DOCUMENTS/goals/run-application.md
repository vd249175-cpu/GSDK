---
type: Developer Guide
title: 创建和运行独立 run
description: 配置独占 run 目录、声明 assembly.mjs 拓扑、使用根目录唯一合法 run.sh 启停并理解 8 步生命周期。
status: stable
tags: [run, assembly, supervisor, lifecycle, execution]
---

# 创建和运行独立 run

在 GraphFramework 中，插件是源码组织与发布边界，而 **run 是最小独立运行实体**。每位开发者或 Agent 拥有独占的 `runs/<name>/` 目录，配置自己需要的后端 Node、物理 Adapter、前端组件及 Rust 微内核实例。

---

## 唯一合法启动命令与架构守卫

> [!CAUTION]
> **严禁任何绕过统一 run 的旁路启动**：
> - 绝对禁止通过 `npm start`、`npx electron` 或临时脚本直接拉起 Electron 窗口；
> - `packages/desktop/host/main.mjs` 中设置了强制架构守卫：
>   ```javascript
>   throw new Error('Launch a configured run from the repository root: bash ./run.sh start runs/<name>/run.config.json');
>   ```
> - 任何环境（开发、测试、CI）下的唯一合法入口只有根目录的 `run.sh`（或透传该命令的一键脚本）。

---

## 主 run 与开发 run 的划分

GraphFramework 明确区分两类 run：

| 类型 | 目录与命名 | 职责与规范 |
| :--- | :--- | :--- |
| **主 run** | **`runs/main/`（名称固定为 `runs/main`）** | 全仓唯一的正式集成与生产交付入口。装配已通过完整验收的核心能力与桌面工作台。严禁把未经验收的实验代码直接装配到 `runs/main`。 |
| **开发 run** | **`runs/<your-name>/`** | 每位开发者或 Agent 的独占工作空间。开发期在 `runs/<your-name>/plugins/` 内隔离开发和测试。 |

---

## 步骤 1：创建独占开发 run 目录


复制 `runs/alice/` 为你的专属命名目录 `runs/<your-name>/`：

```text
runs/<your-name>/
├─ assembly.mjs                 # 业务拓扑与实例装配
├─ run.config.json              # 运行环境、端口与资源配置
├─ start.sh / stop.sh / status.sh   # Bash 一键便捷脚本
└─ start.cmd / stop.cmd / status.cmd # Windows 一键便捷脚本
```

---

## 步骤 2：配置 `assembly.mjs`

在 `assembly.mjs` 中声明当前 run 需要加载的插件与节点实例：

```javascript
export default {
  id: 'example.todo-run',
  contribute(run) {
    // 1. 声明依赖的后端插件路径（非核心插件保持在 run 目录下，不进入 app/）
    run.backendPlugin({
      id: 'example.todo',
      path: './plugins/example-todo',
    })

    // 2. 准入节点实例
    run.node({
      id: 'todo.items',
      plugin: 'example.todo',
      factory: 'createTodoNode',
    })

    // 3. （可选）若包含前端，声明前端插件
    // run.frontendPlugin({
    //   id: 'example.todo-frontend',
    //   path: './plugins/frontend/example-todo',
    // })
  },
}
```

---

## 步骤 3：调整 `run.config.json`

修改 `run.config.json` 中的关键配置：

1. **`name`**：修改为你的目录名 `<your-name>`；
2. **`assembly.modules`**：指向 `./assembly.mjs`；
3. **`lifecycle.startInfos`**：填入启动时由宿主注入的初始业务命令，若不需要可留空 `[]`；
4. **端口与资源隔离**：检查 `kernel.daemon` 端口与 `.generated/` 路径，保证与他人不重叠。

---

## 步骤 4：校验并启动

在仓库根目录执行以下标准流程：

```bash
# 1. 静态校验配置与装配合法性
node packages/tooling/run/src/cli.mjs validate runs/<your-name>/run.config.json

# 2. 启动统一 run
bash ./run.sh start runs/<your-name>/run.config.json

# 3. 检查运行状态与健康度
bash ./run.sh status runs/<your-name>/run.config.json

# 4. 平稳停止运行
bash ./run.sh stop runs/<your-name>/run.config.json
```

### Windows 用户一键脚本

Windows 环境下可直接在命令行或双击运行：
- `runs/<your-name>/start.cmd`
- `runs/<your-name>/status.cmd`
- `runs/<your-name>/stop.cmd`

> [!NOTE]
> 便捷脚本必须保持**纯委托原则**（Pure Delegation），其内部仅透传调用根目录 `run.sh`，严禁编写旁路启动逻辑。

---

## 统一 run 启动的 8 步因果推进全链路

当执行 `run.sh start` 时，由 `supervisor.sh` 严格按以下因果时序编排：

```text
Step 1. 配置校验与锁获取 (run.lock)
  │
Step 2. 独占 Rust 微内核拉起 (kernel-daemon 进程)
  │
Step 3. 后端 Node 宿主就绪 (声明并准入 Node, 认领 Adapter)
  │
Step 4. 前端构建 (buildRunFrontends: Vite 达芬奇产物 + esbuild 打包 host.mjs)
  │
Step 5. 桌面宿主拉起 (Electron 执行 host.mjs 并注入 context.json)
  │
Step 6. 受控通信与达芬奇界面渲染 (只读 Projection 订阅 + 受限 Info 注入)
  │
Step 7. 界面布局与业务就绪 (supervisor 验证健康与几何可见性, 结算 startInfos)
  │
Step 8. 对称平稳停机 (run.sh stop: 关门禁 → 结算在途 → 停观察源 → 释放租约 → 关内核 → 关进程)
```

---

## 下一步

- 出现启动失败或状态未收敛？参考：[排查因果链不推进](debug-causal-flow.md)
- run 深度生命周期与 generation 语义：[命名 run 生命周期](../architecture/application-lifecycle.md)
- 多 Agent 隔离规范：[多 Agent 协作指南](../contracts/multi-agent-run-guide.md)
