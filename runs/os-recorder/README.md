---
type: guide
title: 全电脑操作录制 Run
description: 运行 Microsoft UFO 兼容的 Windows 跨应用操作录制工作台。
status: stable
tags: [run, ufo, recorder, windows]
---

# 全电脑操作录制 Run

该 run 提供与 `browser-recorder` 一致的深色录制工作台，但录制范围扩展为整个
Windows 桌面及跨应用操作。底层使用 Microsoft UFO 官方演示学习流程支持的
Windows Steps Recorder，结果保存为 UFO 可继续处理的 ZIP/MHT。

## 启动

```bash
bash ./run.sh start runs/os-recorder/run.config.json
```

在工作台点击“开始全桌面录制”，切换到任意应用完成演示，再点击“停止并生成记录”。
动作时间线、涉及应用和 ZIP 路径会从 Graph Projection 显示。

## 注意

- 录制产物包含屏幕截图，请先隐藏敏感信息。
- PSR 记录键盘动作类别，但不会记录输入的明文内容。
- Windows 已将 PSR 标记为弃用；本 run 会在启动录制时检查本机是否仍提供
  `psr.exe`，缺失时通过 Projection 返回明确错误。
- 需要将演示总结为 UFO 知识时，再按插件集成文档显式运行 `record_processor`。
