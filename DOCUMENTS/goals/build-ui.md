---
type: Developer Guide
title: 增加桌面界面
description: 基于后端已授权的 rendererRoots、只读 Projection 订阅与达芬奇设计系统，为应用构建桌面前端界面与 Element。
status: stable
tags: [frontend, ui, element, projection, design-system, workbench]
---

# 增加桌面界面

在 GraphFramework 中，桌面界面运行在受控的 Electron 渲染进程中。前端界面通过订阅后端的只读 Projection 渲染事实，通过宿主提供的命令客户端注入受限指令，**绝对禁止在前端伪造第二份业务状态**。

---

## 推荐构建顺序

遵循以下五步递进流程：

```text
1. 后端测试先行 → 2. 授权 rendererRoots → 3. 前端发送命令 → 4. 解码读取 Projection → 5. 隔离临时 UI 状态
```

1. **后端单测通过**：先确保后端 Node 的针对性单元测试全部通过，业务状态流转已确定收敛。
2. **声明 `rendererRoots` 门禁**：在后端插件与工厂描述中，明确声明前端允许调用的命令（`infoType`），并提供参数校验器（`validate`）。内部因果事件绝不公开。
3. **前端命令客户端注入**：前端仅通过 preload / `connectFrontendHost` 提供的受控客户端向后端发送命令。
4. **从 Projection 解码读取事实**：UI 展示的业务数据必须来自权威 Projection，经 `valueCodec.decode` 解码消费。
5. **前端临时状态隔离**：输入草稿、当前选中项、展开/折叠、面板几何布局等只保存在 React / Element 本地状态中，不污染后端业务 State。

---

## 步骤 1：在后端开放 `rendererRoots` 授权

在 `runs/<your-name>/plugins/.../index.mjs` 中，只有通过 `rendererRoots` 显式放行的命令才能被前端成功注入：

```js
// 工厂描述
createTodoNode.describe = () => ({
  kind: 'node',
  localIds: ['todo'],
  rendererRoots: [
    { localId: 'todo', infoType: 'AddTodo' },
  ],
})

// 插件定义中配置强校验门禁
export default defineBackendPlugin({
  id: 'example.todo',
  createNodes: (context) => [createTodoNode(context)],
  rendererRoots: [
    {
      targetNodeId: 'todo.items',
      infoType: 'AddTodo',
      validate: (info) =>
        typeof info?.id === 'string' &&
        typeof info?.title === 'string' &&
        info.title.trim().length > 0,
    },
  ],
})
```

> [!WARNING]
> 未在 `rendererRoots` 中声明或未通过 `validate` 校验的 Info，在桌面宿主门禁处会被直接拦截抛错。

---

## 步骤 2：创建前端插件与 Element 组件

前端组件位于插件目录下的前端子目录（如 `runs/<your-name>/plugins/example-todo-frontend/`，非核心插件保持在 run 独占目录，绝不放入 `app/`）：

```text
runs/<your-name>/plugins/example-todo-frontend/
├─ graphframework.plugin.json       # 前端插件声明
├─ index.jsx                        # Element 注册与组件入口
├─ components/
│  └─ TodoView.jsx                  # React 视图组件
└─ package.json
```

### 前端插件声明

`graphframework.plugin.json`：

```json
{
  "id": "example.todo-frontend",
  "name": "Todo UI",
  "version": "1.0.0",
  "apiVersion": 2,
  "kind": "frontend",
  "contributes": {
    "elements": [
      {
        "id": "todo.panel",
        "title": "待办事项",
        "entry": "index.jsx"
      }
    ]
  }
}
```

### 编写 React 视图组件

在组件中使用 Client SDK hooks 订阅 Projection 并发送命令：

```jsx
import React, { useState } from 'react'
import { useProjection, useCommandClient } from '@graphframework/sdk/client'

export function TodoView() {
  const [draftTitle, setDraftTitle] = useState('') // 临时 UI 状态
  const client = useCommandClient()

  // 1. 订阅权威 Projection，自动跟随 revision 更新
  const todoState = useProjection('todo.items', (state) => state?.items ?? [])

  // 2. 发送受控命令
  const handleAdd = () => {
    if (!draftTitle.trim()) return
    client.send('todo.items', {
      type: 'AddTodo',
      id: crypto.randomUUID(),
      title: draftTitle.trim(),
    })
    setDraftTitle('')
  }

  return (
    <div className="todo-container">
      <div className="todo-input-bar">
        <input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="输入新待办..."
        />
        <button onClick={handleAdd}>添加</button>
      </div>

      <ul className="todo-list">
        {todoState.map((item) => (
          <li key={item.id} className={item.done ? 'is-done' : ''}>
            {item.title}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

---

## 步骤 3：遵循达芬奇设计系统与 Token

为了确保桌面整体视觉质感统一，UI 组件必须遵循达芬奇设计规范：

1. **色彩与主题**：使用语义 CSS 变量（如 `var(--gf-color-bg-base)`, `var(--gf-color-text-primary)`），避免硬编码十六进制颜色。
2. **排版与间距**：使用标准字阶与 4px 网格间距（如 `var(--gf-space-sm)`, `var(--gf-space-md)`）。
3. **零业务侵入**：`packages/frontend/workbench/` 是纯净基座，不得导入任何具体业务插件。

详细色彩与 Token 清单参见 [设计系统](../guides/design-system.md)。

---

## 前端常见禁忌与检查

- [ ] **严禁在前端持有第二份业务 State**：UI 业务展示数据只来自 Projection。
- [ ] **严禁前端自行计算业务结果并写回**：前端只发起意图（如 `AddTodo`），业务 State 始终由后端 Node 权威写入。
- [ ] **严禁绕过 `rendererRoots` 随意发送私有事件**：必须在后端明确授权。

---

## 下一步

- 查阅前端 Client 与 Element SDK 完整 API：[Client 与 Element SDK](../guides/client-sdk-guide.md)
- 查阅设计规范与 Token：[设计系统](../guides/design-system.md)
- 启动包含前端的 run 进行联合调试：[创建和运行独立 run](run-application.md)
