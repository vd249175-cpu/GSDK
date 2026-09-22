---
type: Developer Guide
title: 统一 Run 管理器开发指南
description: 根 run.sh 的公开命令、v2 配置、assembly、包导出、生命周期边界和验证方式。
status: stable
tags: [tooling, run, cli, assembly, lifecycle, distribution, public-api]
---

# 统一 Run 管理器开发指南 (`packages/tooling/run`)

`@graphframework/run` 实现命名 run 的配置解析、assembly、控制面、生命周期记录和能力分发。生产入口只有仓库根 `run.sh`；`src/cli.mjs` 和 `supervisor.sh` 由它调用，不是用户入口。

## 1. 公开命令

```bash
bash ./run.sh validate runs/<name>/run.config.json
bash ./run.sh start runs/<name>/run.config.json
bash ./run.sh status runs/<name>/run.config.json
bash ./run.sh analyze runs/<name>/run.config.json '{"op":"health"}'
bash ./run.sh inspect runs/<name>/run.config.json '{"limit":100}'
bash ./run.sh stop runs/<name>/run.config.json
```

`start` 先校验、加 run-local 锁，再由 Bash supervisor 依次启动 Rust daemon 和宿主；`stop` 请求单飞结算、卸载与关闭。不要直接执行 `cli.mjs`、`supervisor.sh`、Electron、daemon 或任一宿主模块。

能力分发同样经根入口：

```bash
bash ./run.sh pack <capability-dir> [out.zip]
bash ./run.sh verify <capability.zip> [--expect-sha256 <hex>]
bash ./run.sh install <capability.zip> --run runs/<name>/run.config.json
bash ./run.sh pack-run runs/<name> [out.zip]
bash ./run.sh install-run <run.zip> runs
```

## 2. 最小 v2 配置

run 名必须等于配置所在目录名。相对路径以该目录为基准；生成物只能进入该 run 的 `.generated/`。

```json
{
  "version": 2,
  "name": "my-feature",
  "assembly": { "modules": ["assembly.mjs"] },
  "plugins": { "backend": [], "frontend": [] },
  "kernel": {
    "daemonPath": "../../packages/rust/target/debug/graphframework-kernel-daemon",
    "bind": "127.0.0.1:0",
    "startupTimeoutMs": 10000,
    "shutdownTimeoutMs": 10000
  },
  "backend": { "dependencies": {} },
  "frontend": { "instances": [] },
  "graph": { "instances": [] },
  "lifecycle": {
    "initInfos": [],
    "startInfos": [],
    "stopInfos": [],
    "ready": null,
    "timeouts": { "initMs": 30000, "startMs": 30000, "stopMs": 30000, "settleMs": 30000 }
  },
  "scenarios": null,
  "resources": {
    "generatedDirectory": ".generated",
    "dataDirectory": ".generated/data",
    "logsDirectory": ".generated/logs",
    "runtimeDirectory": ".generated/runtime"
  }
}
```

`plugins.backend/frontend` 是 `{id,path}` 数组；`graph.instances` 是显式 `{kind,id,factory,params,bindings}` 数组；前端实例单独位于 `frontend.instances`。旧的字符串插件数组、顶层 `description` 和字符串 `assembly` 都会被拒绝。

## 3. Assembly 模块

```js
export default {
  id: 'my-feature.assembly',
  contribute(run) {
    run.backendPlugin({ id: 'example.counter', path: './plugins/example.counter' })
    run.node({
      id: 'counter',
      plugin: 'example.counter',
      factory: 'createCounterNode',
      params: { initial: 0 },
      bindings: {},
    })
    run.requireNode('counter')
  },
}
```

可用贡献方法是 `backendPlugin`、`frontendPlugin`、`node`、`graph`、`frontend`、`requireNode`。工厂名称必须同时出现在插件 v2 Manifest 和后端模块导出中；图实例内 Node ID 必须位于 `<instance-id>/` 命名空间。

## 4. JavaScript 公开接口

复用方从 `@graphframework/run` 根入口导入。根入口汇总已经公开的 config、assembly、control、discovery、kernel、lifecycle、lock、package、paths、record 和 scenario 契约；稳定子路径仍由 `package.json#exports` 声明。应用插件需要 run-local RPC 时使用 `@graphframework/run/control`，不新增 `src/control.mjs` 深层导入。

生命周期阶段由 `START_STAGES` / `STOP_STAGES` 定义。`startRun` 只为测试/组合调用者委托同一个根 `run.sh`，不会创建第二条启动路径。

## 5. 开发验证

```bash
npm --prefix packages/tooling/run test
npm --prefix packages/tooling/run run typecheck
bash ./run.sh validate runs/main/run.config.json
npm --prefix packages/desktop test -- host/p3-run-lifecycle.test.mjs host/p9-bash-lifecycle.test.mjs --silent
npm --prefix packages/desktop run typecheck
npm --prefix packages/sdk/javascript run typecheck
```

完成标准：v2 配置拒绝未知字段；assembly 只构造显式实例；控制面校验 run identity/token；运行锁和凭据留在本 run；所有启动、检查和停止均经过 `run.sh`。
