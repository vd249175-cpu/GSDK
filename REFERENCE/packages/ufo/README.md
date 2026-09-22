---
type: Architecture Specification
title: Windows 桌面控制与 UFO 自动化套件 (packages/ufo)
description: 基于 Microsoft UFO 的 Windows 桌面自动化引擎：UI 控件巡检、跨窗口键鼠操作与全景屏幕观测接口。
status: stable
tags: [ufo, windows-automation, uia, desktop-control, effect-adapter]
---

# Windows 桌面控制与 UFO 自动化套件 (`packages/ufo`)

源码目录：[`packages/ufo/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/ufo) 与 [`runs/os-recorder/bridge/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/runs/os-recorder/bridge)

`packages/ufo` 是 GraphFramework 的 Windows 原生桌面系统控制套件（集成微软开源 [Microsoft UFO](https://github.com/microsoft/UFO)）。

它将 Windows 底层的 UI Automation (UIA) 句柄操作包装为纯声明式的 GraphFramework 因果事实：**调用方无需直接调用 Win32 或 Python UIA 代码，只需向系统注入标准 Info 脉冲，即可完成桌面窗口嗅探、控件点击、文字键入、窗口最大化及全屏截图**。

---

## 1. 30 秒开箱即用：如何直接使用桌面控制能力？

在已启动 `runs/os-recorder` 宿主的前提下（`bash ./run.sh start runs/os-recorder/run.config.json`），直接向 `example.ufo-computer-control/session` 节点注入以下脉冲：

### 1.1 巡检当前桌面所有打开的窗口并截图
```json
{
  "type": "InspectComputerInfo",
  "requestId": "req-001",
  "observation": {
    "mode": "desktop",
    "includeUiTree": true,
    "takeScreenshot": true
  }
}
```
> **输出结果**：Session 节点的 `windows` 状态立即更新为当前所有顶层窗口列表（含窗口标题、PID、类名），并在 `screenshotPath` 生成高保真 PNG 截图。

### 1.2 聚焦特定窗口并在坐标处点击
```json
{
  "type": "ControlComputerInfo",
  "requestId": "req-002",
  "action": {
    "command": "click_on_coordinates",
    "x": 450,
    "y": 320,
    "button": "left"
  },
  "observation": {
    "mode": "selected-window"
  }
}
```

---

## 2. 核心操作指令全集 (Action Commands Palette)

所有通过 `ControlComputerInfo` 派发的动作均映射至底层的 UFO 自动化指令，包含两大类：

### 2.1 UI 与键鼠交互指令 (`MUTATING_UI_COMMANDS`)
| 指令名称 (`command`) | 必需参数 | 可选参数 | 效果说明 |
| :--- | :--- | :--- | :--- |
| **`click_on_coordinates`** | `x`: X坐标<br>`y`: Y坐标 | `button`: `"left"` \| `"right"` \| `"middle"` | 移动光标并在指定屏幕物理坐标处单击 |
| **`click_input`** | `control`: 控件定位特征 | `double`: 是否双击 | 通过 UIA 找到具体按钮/文本框并触发物理点击 |
| **`double_click`** | `x`, `y` | `button` | 物理双击操作 |
| **`type`** | `text`: 待键入字符串 | `clear`: 是否先清空现有输入框 | 向当前焦点控件模拟物理键盘打字输入 |
| **`set_edit_text`** | `text`: 完整文本内容 | 无 | 通过 UIA ValuePattern 直接赋值（毫秒级，无打字延迟） |
| **`keyboard_input`** | `keys`: 按键序列（如 `"{ENTER}"`） | 无 | 发送功能键、回车、退格或组合热键 |
| **`keypress`** | `key`: 按键名称（如 `"ctrl+s"`） | 无 | 触发系统级全局快捷键 |
| **`scroll`** | `direction`: `"up"` \| `"down"`<br>`amount`: 滚动步长 | 无 | 触发鼠标滚轮滚动 |
| **`drag_on_coordinates`** | `start_x`, `start_y`<br>`end_x`, `end_y` | `duration`: 拖拽持续秒数 | 模拟长按左键拖拽（如画图或移动滑块） |
| **`move`** | `x`, `y` | 无 | 仅平滑移动鼠标光标至目标点 |

### 2.2 窗口管理指令 (`WINDOW_COMMANDS`)
| 指令名称 (`command`) | 必需参数 | 效果说明 |
| :--- | :--- | :--- |
| **`focus_window`** | `handle`: 窗口句柄（或 `title`: 标题正则） | 将目标应用窗口置于前台并获取键盘焦点 |
| **`maximize_window`** | `handle`（或 `title`） | 最大化目标窗口 |
| **`minimize_window`** | `handle`（或 `title`） | 最小化目标窗口 |
| **`restore_window`** | `handle`（或 `title`） | 将最小化/最大化窗口还原为正常视窗 |
| **`close_window`** | `handle`（或 `title`） | 向目标窗口发送 WM_CLOSE 正常退出信号 |

---

## 3. 观测模式与状态产出 (`Observation`)

每次执行完操作后，系统自动依据请求中的 `observation.mode` 生成最新的物理观测快照：

| 观测模式 (`mode`) | 采集内容 |
| :--- | :--- |
| `"desktop"` | 抓取全局全屏截图，枚举系统全部顶层活动窗口列表 |
| `"selected-window"` | 抓取当前选中窗口的局部高精度截图与局部控件 UIA 树 |
| `"control-tree"` | 深度遍历当前聚焦窗口的所有层级控件（按钮、文本、树状列表），输出每个控件的屏幕绝对矩形框 `[left, top, right, bottom]` |

---

## 4. 架构节点与责任链

整个系统通过三大物理分离的 Node 协同运行：
1. **[`UfoComputerSessionNode`](file:///c:/Users/kp157/Desktop/PM/GVSDK/runs/os-recorder/plugins/backend/ufo-computer-control/index.mjs#L20-L125)**（领域状态节点）：管理当前交互会话状态、选中的窗口与最新截图路径；
2. **[`UfoComputerExecutionNode`](file:///c:/Users/kp157/Desktop/PM/GVSDK/runs/os-recorder/plugins/backend/ufo-computer-control/index.mjs#L127-L180)**（执行类 WorldNode）：持有 `ufo/computer-execution` 适配器，专职下发键鼠动作，执行完毕立即结算；
3. **[`UfoComputerObservationNode`](file:///c:/Users/kp157/Desktop/PM/GVSDK/runs/os-recorder/plugins/backend/ufo-computer-control/index.mjs#L182-L240)**（观察类 WorldNode）：持有 `ufo/computer-observation` 适配器，专职读取窗口树与保存截图，零主动写操作。
