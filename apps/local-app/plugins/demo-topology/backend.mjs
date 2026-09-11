import { Node, defineBackendPlugin } from '@graphvideo/backend-sdk'

/**
 * demo-topology：订单履约小图。唯一入口 `demo.orders`，`demo.router`
 * 负责扇出（billing / inventory / 运行中挂接的 screening 节点），
 * `demo.ledger` 汇总回执。拓扑变更只由 main 侧驱动，
 * renderer 不可达（本插件不注册新的 renderer 通道）。
 */
export class OrdersNode extends Node {
  constructor() {
    super('demo.orders', 'Orders', { placed: 0 })
  }

  change(info, ctx) {
    if (info.type === 'SubmitOrder') {
      ctx.patchState({ placed: ctx.read('placed') + 1 })
      ctx.send({ type: 'OrderPlaced', orderId: info.orderId }, 'demo.router')
    }
  }
}

export class RouterNode extends Node {
  constructor() {
    super('demo.router', 'Router', { routed: 0, dropped: 0, screening: [] })
  }

  change(info, ctx) {
    if (info.type === 'AttachScreening') {
      const screening = ctx.read('screening')
      if (!screening.includes(info.nodeId)) ctx.write('screening', [...screening, info.nodeId])
      return
    }
    if (info.type === 'OrderPlaced') {
      let dropped = ctx.read('dropped')
      const forward = (message, targetNodeId) => {
        if (ctx.send(message, targetNodeId).status === 'dropped') dropped += 1
      }
      for (const nodeId of ctx.read('screening')) {
        forward({ type: 'ScreenOrder', orderId: info.orderId }, nodeId)
      }
      forward({ type: 'BillOrder', orderId: info.orderId }, 'demo.billing')
      forward({ type: 'ReserveStock', orderId: info.orderId }, 'demo.inventory')
      ctx.patchState({ routed: ctx.read('routed') + 1, dropped })
    }
  }
}

export class BillingNode extends Node {
  constructor() {
    super('demo.billing', 'Billing', { billed: [] })
  }

  change(info, ctx) {
    if (info.type === 'BillOrder') {
      ctx.write('billed', [...ctx.read('billed'), info.orderId])
      ctx.send({ type: 'ReceiptPosted', orderId: info.orderId }, 'demo.ledger')
    }
  }
}

export class InventoryNode extends Node {
  constructor() {
    super('demo.inventory', 'Inventory', { reserved: [] })
  }

  change(info, ctx) {
    if (info.type === 'ReserveStock') {
      ctx.write('reserved', [...ctx.read('reserved'), info.orderId])
      ctx.send({ type: 'StockReserved', orderId: info.orderId }, 'demo.ledger')
    }
  }
}

export class LedgerNode extends Node {
  constructor() {
    super('demo.ledger', 'Ledger', { receipts: [], reservations: [], verdicts: [] })
  }

  change(info, ctx) {
    if (info.type === 'ReceiptPosted') {
      ctx.write('receipts', [...ctx.read('receipts'), info.orderId])
    } else if (info.type === 'StockReserved') {
      ctx.write('reservations', [...ctx.read('reservations'), info.orderId])
    } else if (info.type === 'FraudVerdict') {
      ctx.write('verdicts', [...ctx.read('verdicts'), `${info.orderId}:${info.verdict}`])
    }
  }
}

/** 运行中才准入的筛查节点：构造与挂接都发生在启动之后。 */
export class FraudNode extends Node {
  constructor() {
    super('demo.fraud', 'Fraud', { screened: [] })
  }

  change(info, ctx) {
    if (info.type === 'ScreenOrder') {
      ctx.write('screened', [...ctx.read('screened'), info.orderId])
      ctx.send({ type: 'FraudVerdict', orderId: info.orderId, verdict: 'clear' }, 'demo.ledger')
    }
  }
}

export function createDemoTopology() {
  return {
    orders: new OrdersNode(),
    router: new RouterNode(),
    billing: new BillingNode(),
    inventory: new InventoryNode(),
    ledger: new LedgerNode(),
  }
}

export default defineBackendPlugin({
  id: 'demo.topology',
  createNodes: () => Object.values(createDemoTopology()),
  // 演示入口保留白名单校验语义：即使未来有 renderer 通道，
  // 也只能提交 SubmitOrder，不能点名任意 Node/Info。
  rendererRoots: [
    {
      targetNodeId: 'demo.orders',
      infoType: 'SubmitOrder',
      validate: (info) => info?.type === 'SubmitOrder' && typeof info?.orderId === 'string',
    },
  ],
})
