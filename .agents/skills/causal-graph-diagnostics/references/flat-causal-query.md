# 扁平因果查询模型

仅在需要局部诱导子图、异构实体路径、单层展开或前端联动审计时读取本文件。

## 1. 规范实体

| kind | 精确地址 | 必需属性 |
| :--- | :--- | :--- |
| Node | `node:<nodeId>` | `nodeId`, `name`, `isWorldNode` |
| change | `change:<nodeId>::<changeName>` | `nodeId`, `triggerInfoType` |
| State | `state:<nodeId>::<field>` | `nodeId`, `field`, `ownerNodeId` |
| Info route | `info:<InfoType>@<targetNodeId>` | `infoType`, `targetNodeId` |
| frontend entry | `entry:<ApplicationMethod>` | `method`, `targetNodeId`, `infoType` |
| UI projection | `ui:<ApplicationState.path>` | `path`, `ownerNodeId`, `ownerField` |

Info 使用“类型 + 目标 Node”寻址，避免同一 Info 类型发送至不同目标时产生虚假生产者/消费者连接。

## 2. 规范关系

参与因果路径的有向边只有：

```text
change -> info route      SEND
info route -> change      TRIGGER
change -> state           WRITE
state -> change           READ_BY
entry -> info route       INJECT
state -> ui projection    PROJECT
```

以下仅是归属边，禁止参与默认 BFS：

```text
node -> change            CONTAINS
node -> state             OWNS
```

Effect 可作为 change 的终端注释；只有存在 Observation 根 Info 时，才通过该 Observation 继续因果路径。不要把 Promise 返回值直接连成领域成功事实。

## 3. 从事实构图

优先级：

1. 指定 submission/causeInfo/changeId 的运行时 `ChangeRecord`。
2. Node.change 源码中的实际 `ctx.send/read/write/effect`。
3. 固定 Vitest 观察到的 ChangeRecord。
4. 自动报告仅用于交叉检查。

不要从 `flows`、`declaredEdges`、`getAllRawEdges()` 构造关系。

对每个 change：

1. 为其 inbound Info 建立 `info:<type>@<change.nodeId> -> change`。
2. 对每个 send 建立 `change -> info:<send.infoType>@<send.targetNodeId>`。
3. 对每个 write 建立 `change -> state:<nodeId>::<field>`。
4. 对每个 read 建立 `state:<nodeId>::<field> -> change`。
5. State 的 owner 永远是地址中的 Node；出现跨 Node 直接 read/write 即报告违反状态所有权。

## 4. 选取 Node 形成诱导子图

设选中 Node ID 集合为 `S`：

- 成员 change：`change.nodeId ∈ S`。
- 成员 State：`state.ownerNodeId ∈ S`。
- 内部 Info：发送 change 的 Node 与目标 Node 均属于 `S`。
- 根入站 Info：目标属于 `S` 且没有图内发送者，标为 `boundary-in`。
- 出站 Info：发送者属于 `S` 且目标不属于 `S`，标为 `boundary-out`。
- 外部发送至成员 Node 的 Info 标为 `boundary-in`，不可把外部发送 change 偷带进子图。

局部图输出至少包含：

```text
selectedNodes
entities { nodes, changes, states, infos }
internalRelations
boundaryIn
boundaryOut
entryPoints
exitPoints
```

所有关系都必须在筛选后重新计算；不可先使用全图统计再裁剪显示。

## 5. 单层自动展开

默认深度为 1。返回选中实体、直接入边、直接出边，并按关系类型分组。

若输入是未限定的 `info:<InfoType>`：

- 先列出所有 `@targetNodeId` 候选；
- 只有唯一候选时自动进入；
- 多候选时保持歧义，不擅自选第一个。

## 6. 任意实体最短路径

使用有向 BFS，队列元素保存实体 ID 与入边。只遍历规范因果边。

- 精确实体到精确实体：普通 BFS。
- Node 作为起点：以该 Node 内所有 change/State 为起点集合。
- Node 作为终点：以该 Node 内所有 change/State 为目标集合。
- Node 只能出现在路径首尾。
- 未限定 Info 可作为候选集合，但结果必须返回最终采用的限定地址。

路径展示格式：

```text
<entity> --<relation>--> <entity> --<relation>--> <entity>
```

找不到正向路径时，再计算反向路径帮助判断方向错误；随后返回从起点可达、最接近目标的边界实体作为断点。

## 7. 前端联动表

每一行只声明图外边界，不声明图内流：

```ts
interface FrontendCausalLink {
  id: string
  applicationMethod: string
  injection: { targetNodeId: string; infoType: string }
  projections: Array<{
    ownerNodeId: string
    ownerField: string
    applicationStatePath: string
    consumers: string[]
  }>
}
```

建议随机测试不变量：

- 每个 Application 方法只有一个明确 Handler。
- injection 目标 Node 已挂载，根 Info 有消费 change。
- 从根 Info 到每个预期 State 字段存在真实 send/read/write 路径。
- Projection 读取的 Node.field 确实存在且 Owner 唯一。
- UI 消费路径存在于 ApplicationState 类型与投影结果中。
- 任意随机操作序列静止后，Projection 与 Owner State 对账一致。

随机测试必须记录 seed，并将失败序列收缩为可固化的针对性 Vitest。
