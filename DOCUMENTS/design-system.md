---
type: reference
---

# Workbench 设计系统

## 1. 原则

- 工作台采用专业、高密度、克制的桌面界面表达。
- dark、light、xueqing、shiliuqun 四套主题保持结构与可读性对等。
- 组件只消费语义或组件 Token；原始色值只由主题文件拥有。
- 设置背景时同步确认前景、边框、hover、focus、disabled 与错误状态。

## 2. 当前样式入口

`@graphvideo/sdk/workbench/styles.css` 指向 `sdk/workbench/src/styles/index.css`，依次聚合：

```text
typography.css
theme.css
theme-light.css
theme-traditional.css
dock.css
workspace-tabs.css
controls.css
panel-chrome.css
scrollbars.css
```

`apps/local-app/renderer/src/app.css` 只包含示例应用自身布局，并消费工作台 Token。主题通过根元素的 `data-theme="light|xueqing|shiliuqun"` 切换；无属性时使用 dark。

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

- `sdk/workbench/src/styles/typography-boundary.test.ts` 保证 feature styles 使用共享排版 Token。
- UI 测试验证 Token 使用和主题切换，不把截图色值当作组件契约。
- 人工验收四套主题的文字、边框、hover、focus、disabled、error、菜单与浮层层级。
