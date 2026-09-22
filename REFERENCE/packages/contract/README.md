---
type: API Reference
title: 机器契约与协议操作全集 (packages/contract)
description: 全仓唯一声明式机器契约：23 项协议操作、入参/返回规范、错误码全集与 Golden Frames 验证指南。
status: stable
tags: [contract, operations, errors, golden-frames, zero-code, json-rpc]
---

# 机器契约与协议操作全集 (`packages/contract`)

源码目录：[`packages/contract/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/contract)

`packages/contract` 是全仓的唯一声明式事实与跨语言契约中心。**所有语言宿主（Rust、TypeScript、Python、C++）与外部通信协议必须 100% 严格满足本目录定义的 JSON 规约**。

无论通过 CLI、Socket 还是 STDIN/STDOUT 与 GraphFramework 交互，只要按本指南构造 JSON 报文，无需看任何源码即可开箱即用。

---

## 1. 23 项全量协议操作字典 (`operations.json`)

通信报文格式统一为：
```json
{
  "version": "1.0",
  "id": 1,
  "token": "<32字节十六进制密钥>",
  "op": "<操作名称>",
  "<参数名>": "<参数值>"
}
```

以下是全部 23 项操作的完整规约（无一遗漏）：

### 1.1 系统与健康检查
| 操作名 (`op`) | 必需参数 | 可选参数 | 返回结果字段 | 作用与示例 |
| :--- | :--- | :--- | :--- | :--- |
| **`health`** | 无 | 无 | `pid`, `nodes`, `pending` | **系统探活与负载查询**。<br>返回当前守护进程 PID、当前所有准入节点清单及未决单飞任务总数。 |

### 1.2 节点生命周期管理
| 操作名 (`op`) | 必需参数 | 可选参数 | 返回结果字段 | 作用与示例 |
| :--- | :--- | :--- | :--- | :--- |
| **`admit`** | `nodeId`: 节点唯一标识<br>`initialState`: 初始 JSON 状态对象 | `analysisFacts`: 静态拓扑事实<br>`effectCapabilities`: 允许触发的副作用列表 | `generation`: 初始代数（通常为 1） | **准入并初始化节点**。<br>`{"op": "admit", "nodeId": "downloader", "initialState": {"progress": 0}}` |
| **`evict`** | `nodeId`: 待卸载节点 ID | 无 | 无 | **注销节点**。冻结并丢弃其队列，产生墓碑（Tombstone）。 |
| **`replace`** | `nodeId`: 目标节点 ID<br>`initialState`: 新初始状态 | `analysisFacts`: 新的静态拓扑事实 | `generation`: 新代数（自增） | **热替换节点**。清空积压 Backlog，新实例干净启动。 |

### 1.3 任务注入、认领与单飞调度
| 操作名 (`op`) | 必需参数 | 可选参数 | 返回结果字段 | 作用与示例 |
| :--- | :--- | :--- | :--- | :--- |
| **`inject`** | `targetNodeId`: 接收节点<br>`info`: 脉冲对象 `{ "type": "..." }`<br>`submissionId`: 溯源批次 ID | 无 | `duplicate`: 是否重复提交<br>`feedback`: 物理投递结果 (`enqueued` / `dropped`) | **外部注入根任务**。<br>`{"op": "inject", "targetNodeId": "calc", "info": {"type": "Add", "a": 1, "b": 2}, "submissionId": "s-101"}` |
| **`claim`** | `nodeIds`: 节点 ID 数组 | 无 | `claimed`: 成功认领的节点列表 | **Worker 认领节点执行权**。声明本连接负责消费指定节点的队列。 |
| **`poll`** | 无 | `waitMs`: 阻塞等待毫秒数 | `change`: 单飞任务上下文（或 `null`） | **Worker 拉取任务**。返回当前节点的 `changeId`、接收到的 `info` 及当前 `state`。 |
| **`commit`** | `changeId`: 正在执行的 Change ID | `operations`: 状态写入操作列表<br>`error`: 失败原因（若发生异常） | `settled`: 是否结算成功布尔值 | **Worker 提交执行结果并释放单飞锁**。<br>`operations` 支持 `[{"op": "write", "key": "progress", "value": 100}]`。 |
| **`cancel`** | `submissionId`: 待取消批次 ID | 无 | `cancelled`: 是否成功取消 | **一键取消长任务批次**。未出队的任务直接丢弃，不予执行。 |

### 1.4 控制面干预与状态观测
| 操作名 (`op`) | 必需参数 | 可选参数 | 返回结果字段 | 作用与示例 |
| :--- | :--- | :--- | :--- | :--- |
| **`intervene`** | `nodeId`<br>`patch`: 状态更新字典<br>`expectedGeneration`: 期望代数<br>`expectedVersion`: 期望版本 | 无 | `version`: 新版本号<br>`state`: 更新后的全量状态 | **单飞间隙状态强制写入**。通过代数与版本号严格防并发脏写。 |
| **`projection`** | 无 | 无 | `nodes`: 全节点状态字典<br>`scheduler`: 调度统计指标 | **读取全图状态投影**。前端或监控大屏的一键拉取接口。 |
| **`setErrorTarget`**| `nodeId`: 默认错误汇聚节点 ID | 无 | 无 | **配置全图未捕获异常默认路由目标**。 |

### 1.5 因果拓扑分析与体检
| 操作名 (`op`) | 必需参数 | 可选参数 | 返回结果字段 | 作用与示例 |
| :--- | :--- | :--- | :--- | :--- |
| **`setAnalysisContext`**| `frontendLinks`: 前端关联数组<br>`frontendServiceLinks`: 服务链路数组 | 无 | `analysisRevision`: 当前分析索引修订号 | **设置前端交互拓扑上下文**。 |
| **`analyze`** | `request`: 分析请求对象 `{ "op": "health" \| "path" \| ... }` | 无 | `analysis DTO`: 结构化分析报告 | **直接运行内置拓扑算法**。详见 [分析引擎规约](file:///c:/Users/kp157/Desktop/PM/GVSDK/REFERENCE/packages/rust/analysis/README.md)。 |

### 1.6 Agent 可信控制面操作
| 操作名 (`op`) | 必需参数 | 可选参数 | 返回结果字段 | 作用与示例 |
| :--- | :--- | :--- | :--- | :--- |
| **`agentInspect`** | 无 | `after`: 时间戳游标<br>`limit`: 最大返回事件数 | `projection`, `pending`, `drops`, `activeChanges`, `leases`, `effects`, `submissions`, `events` | **Agent 全息可观测入口**。一次性拉取图状态、丢弃台账、租约与因果事件环。 |
| **`agentInject`** | `actor`: Agent 名称<br>`reason`: 注入原因<br>`submissionId`, `targetNodeId`, `info` | 无 | `duplicate`, `feedback` | **携带审计痕迹的 Agent 脉冲注入**。自动进入全景遥测审计链。 |
| **`agentInterveneState`**| `actor`, `reason`, `nodeId`, `patch`, `expectedGeneration`, `expectedVersion` | 无 | `version`, `state` | **携带审计痕迹的 Agent 状态原子修正**。 |

### 1.7 物理副作用 (Effect) 分布式委派协议
| 操作名 (`op`) | 必需参数 | 可选参数 | 返回结果字段 | 作用与示例 |
| :--- | :--- | :--- | :--- | :--- |
| **`claimEffects`** | `adapterIds`: 适配器标识数组 | 无 | `adapterIds`: 成功认领的适配器列表 | **Provider 认领副作用处理能力**（如认领 `["fs-write", "http-post"]`）。 |
| **`releaseEffects`**| `adapterIds`: 待释放适配器数组 | 无 | `adapterIds`: 成功释放列表 | **释放对指定副作用的处理权**。 |
| **`pollEffect`** | 无 | 无 | `effectId`, `changeId`, `nodeId`, `generation`, `adapterId`, `request` | **Provider 拉取待执行物理动作**。若当前无请求返回空。 |
| **`requestEffect`**| `changeId`: 当前正在执行的 Change ID<br>`adapterId`: 目标适配器<br>`request`: 动作请求参数 DTO | 无 | `effectId`: 生成的副作用任务 ID | **Node 在 Change 内发起外部动作**。将阻塞等待其完成。 |
| **`awaitEffect`** | `effectId`: 副作用任务 ID | 无 | `observation`: 观察事实（或 `error`） | **Node 挂起等待动作执行结果**。 |
| **`completeEffect`**| `effectId`<br>`ok`: 动作是否成功布尔值 | `observation`: 成功输出结果<br>`error`: 失败错误文案 | `effectId`, `completed`: true | **Provider 提交物理执行结果**。唤醒挂起的 Node 继续因果变迁。 |

---

## 2. 错误码与拒绝原因全集 (`errors.json`)

系统在处理请求时，严格返回以下三类标准化错误：

### 2.1 协议层阻断拒绝 (`daemonRejections`)
1. `"unknown protocol version"`：协议版本不匹配（当前固定为 `"1.0"`）；
2. `"missing or wrong token"`：连接未携带合法鉴权 Token；
3. `"analysisFacts.version != 1"`：静态分析元数据格式版本错误；
4. `"analysisFacts.nodeId mismatch"`：实体事实冒充了其他节点的 Node ID；
5. `"entity/edge count over cap"`：快照规模超过单节点上限（实体 > 5000 或边 > 20000）；
6. `"snapshot over 256 KiB"`：单节点快照体积超出物理上限（256 KiB）；
7. `"single fold over 64 groups/5000 leaves"`：折叠树规模超出处理限制；
8. `"response over 512 KiB"`：分析计算响应超出上限；
9. `"generation/version precondition mismatch"`：状态干预时乐观并发锁冲突；
10. `"duplicate submissionId with different content"`：同一任务批次 ID 被重复注入了不同内容。

### 2.2 微内核调度错误 (`kernelErrors`)
- `DuplicateEntity`：`"entity already admitted: {id}"`
- `UnknownEntity`：`"entity not admitted: {id}"`
- `StaleGeneration`：`"entity generation changed: {id}"`
- `AlreadyBound`：`"entity already bound: {id}"`
- `Busy`：`"entity busy, replace runs only in the single-flight gap: {id}"`

### 2.3 单飞开闭错误 (`beginErrors`)
- `Busy`：目标实体正处于活跃 Change 状态；
- `Sealed`：目标实体正处于替换密封态，新任务冻结；
- `Empty`：目标实体队列无待决脉冲。

---

## 3. Golden Frames 黄金帧验证与回归测试

[`golden-frames/`](file:///c:/Users/kp157/Desktop/PM/GVSDK/packages/contract/golden-frames) 目录中存储了全套行为测试向量（如 `daemon-counter-cycle.json`）。

任何新增语言的 SDK、外部客户端或测试桩，**只要按文件中的 `requests` 依次发送操作，比对最终的 `expect.projection`**，即可证明其完全合规，无需搭建全量 Electron 环境即可自动化回归。
