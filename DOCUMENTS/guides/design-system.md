---
type: Developer Guide
title: Workbench 设计系统与样式规约
description: 工作台设计原则、主题变量、语义 Token 与排版规范。
status: stable
tags: [design-system, theme, tokens, styling, workbench]
---

# Workbench 设计系统

## 1. 原则

- 工作台采用专业、高密度、克制的桌面界面表达。
- 统一范围是达芬奇视觉、排版、布局交互与页面联动；插件内部按钮、表单和业务操作自由编写，不要求统一控件 DSL。
- dark、light、xueqing、shiliuqun 四套主题保持结构与可读性对等。
- 组件只消费语义或组件 Token；原始色值只由主题文件拥有。
- 设置背景时同步确认前景、边框、hover、focus、disabled 与错误状态。

## 2. 当前样式入口

`@graphframework/theme` 提供达芬奇主题、排版和全局样式。`@graphframework/workbench/styles/index.css` 聚合主题底座及布局样式。桌面入口依次加载工作台样式与统一主题，保持现有视觉层级和主题覆盖顺序：

```text
@graphframework/workbench/styles/index.css
  → @graphframework/theme/base.css
      → theme/styles/base/{typography,theme,theme-light,theme-traditional}.css
  → workbench/src/styles/{dock,workspace-tabs,controls,panel-chrome,scrollbars}.css
@graphframework/theme
  → theme/styles/{typography,theme,theme-light,theme-traditional,globals}.css
Studio 自有样式
  → app/plugins/graphframework.studio/frontend/styles/index.css
```

`app/plugins/demo-topology/frontend/app.css` 只包含示例应用自身布局，并消费工作台 Token。主题通过根元素的 `data-theme="light|xueqing|shiliuqun"` 切换；无属性时使用 dark。

## 3. 新代码使用的 Token

| 类别 | Token |
| :--- | :--- |
| Surface | `--surface-canvas/app/header/panel/panel-subtle/raised/document/input/hover/selected/backdrop` |
| Content | `--content-primary/secondary/tertiary/on-action` |
| Border | `--border-subtle/default/strong`、`--focus-ring` |
| Action | `--action-primary-bg/bg-hover/border/fg` |
| State | `--state-success-*`、`--state-warning-*`、`--state-danger-*` |
| Overlay | `--overlay-scrim`、`--shadow-floating` |
| Typography | `--font-family-*`、`--font-size-*`、`--font-weight-*`、`--line-height-*` |

`--text-*`、`--accent-primary` 和 `--status-*` 是主题文件中仍存在的兼容 Token。新组件不再使用它们，也不要机械替换已有消费者，因为不同主题下的值不保证等价。

## 4. 示例

```css
.panel-card {
  background: var(--surface-raised);
  color: var(--content-primary);
  border: 1px solid var(--border-default);
}

.panel-card:focus-visible {
  outline: 1px solid var(--focus-ring);
}

.primary-action {
  background: var(--action-primary-bg);
  color: var(--action-primary-fg);
  border: 1px solid var(--action-primary-border);
}
```

共享组件 CSS/TSX 不新增 Hex、RGB 或绑定某个主题的 fallback。需要新增颜色语义时，应在四套主题中同时定义，并优先增加含义稳定的语义 Token，而不是暴露 palette。

## 5. 验证

- `packages/frontend/workbench/src/styles/typography-boundary.test.ts` 保证 feature styles 使用共享排版 Token。
- UI 测试验证 Token 使用和主题切换，不把截图色值当作组件契约。
- 人工验收四套主题的文字、边框、hover、focus、disabled、error、菜单与浮层层级。

## 6. 动态页面与联动

`packages/frontend/workbench/src/dock/` 提供现有区域切分、停靠、拖动、比例调整与浮动页面；布局状态由工作台保存。浮动页面同步主文档样式及根元素的主题、字体和字号属性，`floatingWindow.ts` 在生命周期结束时清理 MutationObserver。

工作台支持页面重载与 ElementSource 贡献清单刷新；它们不等于后端 Node generation 替换，也不提供后端 State 继承。跨页面上下文通过 Workbench Context 与 Element 状态绑定共享，业务事实仍只读 Projection。Context/布局可以反映选择、焦点等 UI 状态，不能成为第二份业务 State。

这套统一交互由 frontend 包提供。插件仅在有用户操作需求时贡献 Element/Workspace，并消费现有机制；是否有界面不改变 Node/Info/State 协议。
