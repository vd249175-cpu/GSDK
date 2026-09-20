# 开发指南 (Guides)

本目录按使用顺序组织。业务开发者从任务入口开始，不需要先读 Kernel、daemon 或 SDK 包边界。

## 开始开发

* [业务开发入门](application-development.md) - 从需求到 Node、插件、测试、run 装配与启动的完整主路径。
* [测试分层与验证规范](testing.md) - 如何选择最小测试与项目中的验证命令正本。

## 按需增加能力

* [Client 与 Element SDK 开发指南](client-sdk-guide.md) - 需要桌面界面时使用的投影订阅、命令客户端与 Workbench Element。
* [Workbench 设计系统与样式规约](design-system.md) - 需要新增或修改界面时使用的主题、语义 Token 与排版规范。

## 平台与高级边界

以下内容不是业务开发的前置阅读：

* [Plugin SDK 开发指南与装配边界](plugin-sdk-guide.md) - Manifest 校验、宿主信任边界、Agent 控制面和运行时替换。
* [Kernel 与 Node SDK 开发指南](kernel-sdk-guide.md) - 调度、submission、原生规则空间与底层 Node 运行契约。
