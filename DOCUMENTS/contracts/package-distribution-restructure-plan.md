---
type: Contract
title: 当前目录与分发边界
description: 仓库目录职责边界、应用装配、镜像 SDK 与桌面构建组织。
status: stable
tags: [workspace, distribution, packaging, boundaries]
---

# 当前目录与分发边界

仓库以应用装配、普通业务插件和可复用平台包划分责任。根目录不承担 npm workspace、依赖安装或桌面构建。

## 目录

`app/application.json` 声明应用身份、默认主题、默认工作空间、启用插件及桌面入口；`app/plugins/` 保存本仓库业务插件。应用目录不包含 Electron 工程、renderer 工程或构建脚本。插件路径相对于 application.json 所在目录解析，也允许引用任意外部目录。

`packages/desktop/` 提供通用 Electron 启动器、图宿主、插件目录清单、窗口 Adapter、renderer 入口及构建链。它按应用配置加载插件，不静态导入 Studio。Studio 的业务主进程接入、项目服务和资源属于 `app/plugins/graphframework.studio/`。

`packages/frontend/theme/` 提供达芬奇视觉主题和排版；`workbench/` 提供现有切分、停靠、尺寸调整、浮动页面和工作空间机制；`context/` 提供跨页面上下文；`client/` 提供通用客户端 hooks；`ui/` 提供可选公共组件。插件内部界面自由编写，并消费统一主题及工作台机制。

`packages/sdk/javascript/` 与 `packages/sdk/python/` 镜像 protocol、node、effect、plugin、analysis、agent、testing 七个能力面。frontend 和 desktop 是前端生态的专属宿主能力，不进入 Python 镜像。

`packages/contract/` 保存版本、操作、错误及黄金帧。`packages/rust/` 保存业务无关调度、动态分析、daemon、C ABI 和 N-API，运行语义未因目录迁移改变。

`packages/tooling/` 保存因果可视化和 AST/LanguageService 重构工具。`DOCUMENTS/` 保存 OKF 文档；`AGENTS.md` 保存开发约束。

## 依赖和源码构建

平台生产源码不得导入业务插件。插件通过公开 SDK、frontend 和 desktop 接口接入平台；插件自己的业务代码、界面和资源收在同一个插件目录。

各 npm 包独立管理清单、依赖与锁文件。桌面源码构建使用 esbuild/Vite 的明确源码入口；JS SDK 的 `graphframework-source` 条件供支持 TypeScript 的 Node 宿主直接消费源码，默认出口仍是发布构建产物。Node_modules、dist、Cargo target 和测试缓存属于生成物。

## 验证入口

`npm --prefix packages/desktop run build` 构建通用宿主及启用插件。

`npm --prefix packages/desktop run typecheck` 与 `npm --prefix packages/sdk/javascript run typecheck` 执行类型检查。

`npm --prefix packages/desktop test -- <目标文件> --silent` 执行针对性测试。

`npm --prefix packages/desktop run start` 构建并启动配置中的应用；外部应用可通过 GRAPHFRAMEWORK_APPLICATION 指定 application.json 的绝对路径。

## 发布与协作

目录归位只说明源码归属和当前构建入口。镜像 SDK 的共同验收、独立包、版本/摘要/兼容信息、任意目录分发演练及性能要求见 [SDK 与插件分发验收契约](distribution-contract.md)；不能用目录迁移完成替代这些验收。

官方插件与协作者插件使用同一 Manifest、SDK 和生命周期。正式发布插件只由发布方更新，协作者的扩展收在自己的插件中；规则见 [插件发布与协作契约](plugin-collaboration-contract.md)。本次目录调整没有增加 State 自动迁移、回滚或跨 generation 消息保留。
