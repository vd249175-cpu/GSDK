---
type: Architecture Specification
title: 前端工作台与客户端 Hooks 全量规约 (packages/frontend)
description: 零业务工作台底座、达芬奇语义 CSS Token 全集、Client Hooks 导出（useNodeState 等）与插件 UI 挂载。
status: stable
tags: [frontend, workbench, theme, hooks, useNodeState, renderer-roots, element]
---

# 前端工作台与客户端 Hooks 全量规约 (`packages/frontend`)

源码目录：[`packages/frontend/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/frontend)

`packages/frontend` 包含前端 UI 视图层所需的全部核心基础设施。前端严格遵循**单向因果投影消费原则**：UI 组件只读订阅微内核的状态投影（Projection），严禁在前端私自篡改或伪造第二份状态。

---

## 1. 客户端 Hooks 接口全集 (`@graphframework/client`)

源码入口：[`packages/frontend/client/hooks.ts`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/frontend/client/hooks.ts)

通过 `defineClientHooks` 导出的 React 状态响应 Hooks 清单（无一遗漏）：

| Hook 名称 | 参数签名 | 返回值 | 职责与物理行为 |
| :--- | :--- | :--- | :--- |
| **`useNodeState`** | `nodeId: string, selector?: (state: T) => R` | `R \| undefined` | **订阅特定 Node 的因果状态**。当微内核中该 Node 发生 Change 时，自动触发组件细粒度重渲染。 |
| **`useAppState`** | `selector: (state: AppState) => T` | `T` | 读取全图聚合全局状态快照。 |
| **`useApplicationRevision`** | 无 | `number` | 获取当前应用状态全局修订版本号，用于判断图是否发生因果变迁。 |
| **`useClientState`** | `selector: (state: ClientState) => T` | `T` | 读取客户端纯本地状态（如当前选中的选项卡、UI 展开折叠态）。 |
| **`useWorkbenchContext`** | `token: ContextToken<T>, binding?` | `[value, write]` | 读写工作台上下文变量（如当前活动的 Project ID 或 Workspace）。 |
| **`useElementState`** | `runtime, stateId: string, binding?`| `[value, write]` | 读写特定工作台 Element 组件的私有 UI 状态。 |
| **`useApplicationClient`** | 无 | `AppClient` | 获取与主进程后端通信的 RPC 客户端句柄。 |
| **`useShellClient`** | 无 | `ShellClient` | 获取操作系统外壳交互客户端（打开外部链接、弹窗等）。 |

### 1.1 开箱即用：在 React 中展示节点状态示例
```tsx
import React from 'react';
import { useNodeState } from '@graphframework/client';

export function CounterWidget() {
  // 零手动 fetch，零 WebSocket 轮询，自动按需高频刷新
  const count = useNodeState('node-counter', (s) => s.count);

  return (
    <div className="counter-card" style={{ background: 'var(--gv-bg-surface)' }}>
      <span style={{ color: 'var(--gv-text-muted)' }}>当前计数值：</span>
      <strong style={{ color: 'var(--gv-accent)', fontSize: '18px' }}>{count ?? 0}</strong>
    </div>
  );
}
```

---

## 2. 插件 UI 挂载槽位与声明 (`rendererRoots`)

业务插件通过声明 `graphframework.plugin.json` 将自定义 React 组件挂载进工作台各物理槽位：

```json
{
  "id": "my-plugin",
  "rendererRoots": [
    {
      "mountId": "sidebar-main",
      "component": "./frontend/sidebar.tsx"
    },
    {
      "mountId": "dock-bottom",
      "component": "./frontend/terminal-panel.tsx"
    }
  ]
}
```

### 标准支持的挂载点 (`mountId`)：
- `"sidebar-main"`：工作台主左侧边栏；
- `"dock-bottom"`：底部控制台/日志抽屉；
- `"dock-right"`：右侧属性检查与详情面板；
- `"editor-area"`：中央主体工作区；
- `"header-tools"`：顶部导航栏工具扩展区。

---

## 3. 达芬奇设计系统 CSS Token 完整字典

源码目录：[`packages/frontend/theme/styles/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/frontend/theme/styles)

样式严禁编写裸 Hex 颜色，必须 100% 引用以下达芬奇标准语义变量：

### 3.1 背景与表面 (Surfaces)
- `--gv-bg-base`：应用主底色（高纯度极深灰黑，如 `#121214`）；
- `--gv-bg-surface`：卡片、面板、菜单主背景；
- `--gv-bg-elevated`：浮动弹窗、Tooltip、下拉浮层背景；
- `--gv-bg-subtle`：输入框、表格斑马线浅背景。

### 3.2 文本与排版 (Typography)
- `--gv-text-primary`：正文最高对比度文本；
- `--gv-text-secondary`：次级说明文本；
- `--gv-text-muted`：禁用态、占位符与微弱辅助文本。

### 3.3 状态与因果标识 (Causal Status)
- `--gv-accent`：主操作、焦点选中与品牌强调色；
- `--gv-status-active` / `--gv-status-success`：节点就绪、活跃执行（翡翠绿）；
- `--gv-status-warning`：队列积压预警、降级状态（琥珀橙）；
- `--gv-status-error`：因果阻塞、执行异常、丢弃故障（猩红）。

### 3.4 边框与间距 (Layout)
- `--gv-border-subtle`：微弱分割线（1px 线条）；
- `--gv-border-strong`：卡片聚焦高亮外框；
- `--gv-radius-sm` (4px), `--gv-radius-md` (8px), `--gv-radius-lg` (12px)。
