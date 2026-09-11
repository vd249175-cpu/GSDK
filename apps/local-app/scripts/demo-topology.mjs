#!/usr/bin/env node
/**
 * 运行时拓扑演示（main 侧可信调用，renderer 不可达）：
 * 启动装配 5 节点 → 跑流量 → 运行中 admit 筛查节点 → 运行中 evict 库存节点
 * （send 反馈 dropped，提交照常结算）→ 同 ID 重准入（代次 +1，纯净初值启动）。
 * 任意断言失败即抛错退出；只读投影，不启动 Electron / renderer。
 */
import assert from 'node:assert/strict'
import { NativeRuleSpace, mountDomainNode } from '@graphvideo/backend-sdk'
import { FraudNode, InventoryNode, createDemoTopology } from '../plugins/demo-topology/backend.mjs'

const step = (title) => console.log(`\n## ${title}`)
const show = (space, label) => {
  const projection = space.readProjection()
  const rows = projection.nodes
    .map((entry) => `${entry.nodeId}@${space.generation(entry.nodeId)}`)
    .sort()
  console.log(`- ${label}: revision=${projection.revision} nodes=[${rows.join(', ')}]`)
}
const ledgerOf = (space) => space.getState('demo.ledger')
const routerOf = (space) => space.getState('demo.router')

async function submitOrder(space, orderId) {
  const submission = space.injectRoot('demo.orders', { type: 'SubmitOrder', orderId })
  await space.waitForSubmission(submission)
}

const space = new NativeRuleSpace()
try {
  step('0. boot: mount base topology')
  const base = createDemoTopology()
  for (const node of Object.values(base)) mountDomainNode(space, node)
  show(space, 'mounted')
  assert.equal(space.generation('demo.fraud'), null)

  step('1. traffic before admission')
  await submitOrder(space, 'order-1')
  await submitOrder(space, 'order-2')
  assert.deepEqual(ledgerOf(space).receipts, ['order-1', 'order-2'])
  assert.deepEqual(ledgerOf(space).reservations, ['order-1', 'order-2'])
  assert.deepEqual(ledgerOf(space).verdicts, [])
  show(space, 'steady')

  step('2. admit demo.fraud at runtime + attach screening')
  assert.equal(mountDomainNode(space, new FraudNode()), 0)
  assert.throws(() => mountDomainNode(space, new FraudNode()), /already registered/i)
  const attach = space.injectRoot('demo.router', { type: 'AttachScreening', nodeId: 'demo.fraud' })
  await space.waitForSubmission(attach)
  assert.deepEqual(routerOf(space).screening, ['demo.fraud'])
  await submitOrder(space, 'order-3')
  assert.deepEqual(ledgerOf(space).verdicts, ['order-3:clear'])
  assert.deepEqual(space.getState('demo.fraud').screened, ['order-3'])
  show(space, 'fraud admitted')

  step('3. evict demo.inventory at runtime')
  assert.equal(space.unregister('demo.inventory'), true)
  assert.equal(space.unregister('demo.inventory'), false)
  assert.equal(space.generation('demo.inventory'), 1)
  await submitOrder(space, 'order-4')
  assert.equal(routerOf(space).dropped, 1)
  assert.deepEqual(ledgerOf(space).receipts, ['order-1', 'order-2', 'order-3', 'order-4'])
  assert.deepEqual(ledgerOf(space).reservations, ['order-1', 'order-2', 'order-3'])
  assert.deepEqual(ledgerOf(space).verdicts, ['order-3:clear', 'order-4:clear'])
  assert.ok(!space.readProjection().nodes.some((entry) => entry.nodeId === 'demo.inventory'))
  show(space, 'inventory evicted')

  step('4. re-admit demo.inventory: generation +1, clean state')
  assert.equal(mountDomainNode(space, new InventoryNode()), 1)
  assert.deepEqual(space.getState('demo.inventory').reserved, [])
  await submitOrder(space, 'order-5')
  assert.deepEqual(space.getState('demo.inventory').reserved, ['order-5'])
  assert.equal(routerOf(space).dropped, 1)
  show(space, 'inventory re-admitted')

  console.log('\ndemo-topology: OK')
} finally {
  await space.dispose()
}
