---
type: guide
name: theme-color-management
description: >-
  GraphFramework Studio theme styling rules (dark, light, xueqing, shiliuqun). Use when editing
  CSS or TSX styles, adding components, fixing contrast, or migrating legacy palette aliases
  to semantic tokens.
---

# Theme and Color Management
Read `DOCUMENTS/guides/design-system.md` and inspect `packages/frontend/theme/styles/theme.css`, `theme-light.css` and the corresponding `styles/base/` files before editing.

The desktop entry imports `@graphframework/workbench/styles/index.css` followed by `@graphframework/theme`. Workbench layout CSS imports `@graphframework/theme/base.css`; the files above own the theme values.

## Rules

1. Components consume semantic tokens; raw colours belong only in theme definitions.
2. New code must not use `--palette-source-*`, `--bg-*`, `--text`, or other legacy aliases.
3. A custom background must have a deliberate foreground, border and focus treatment.
4. Dark and light themes must expose equivalent hierarchy and readable states.
5. Modal and floating surfaces use `--surface-raised`, `--border-strong`, `--overlay-scrim` and `--shadow-floating`.

Preferred token groups:

```text
--surface-*
--content-*
--border-*
--action-*
--state-*
--font-*
--line-height-*
```

Example:

```css
.card {
  background: var(--surface-raised);
  color: var(--content-primary);
  border: 1px solid var(--border-default);
}
```
After editing, inspect each theme (dark, light, xueqing, shiliuqun) manually. Use targeted style/component tests; do not launch or control the desktop app automatically.
