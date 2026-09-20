# GraphFramework SDK

GraphFramework 是一个面向桌面与后端系统的因果应用框架，用于构建由业务事实和显式因果事件驱动的高可靠应用。业务开发者无需先理解 Rust 内核或底层调度实现。

---

## 快速运行

应用运行采用统一规范入口 `run.sh`：

```bash
# 校验 run 配置
node packages/tooling/run/src/cli.mjs validate runs/<name>/run.config.json

# 启动运行
bash ./run.sh start runs/<name>/run.config.json

# 查看状态
bash ./run.sh status runs/<name>/run.config.json

# 平稳停止
bash ./run.sh stop runs/<name>/run.config.json
```

> [!NOTE]
> Windows 用户亦可直接执行 `runs/<name>/start.cmd`、`status.cmd` 与 `stop.cmd`。严禁通过 `npm start` 或直接拉起 Electron 绕过统一 run。

---

## 文档中心与开发规范

- **文档中心（三层结构）**：完整的目标入口、架构心智与权威参考详见 **[文档中心 (DOCUMENTS/README.md)](DOCUMENTS/README.md)**。
  - 新成员接入：[第一次准备开发环境](DOCUMENTS/goals/first-setup.md)
  - 业务开发：[开发第一个业务功能](DOCUMENTS/goals/build-feature.md)
  - 启动与生命周期：[创建和运行独立 run](DOCUMENTS/goals/run-application.md)
- **开发守则与安全红线**：架构红线、唯一合法启动方式与团队安全规范详见 **[AGENTS.md](AGENTS.md)**。
