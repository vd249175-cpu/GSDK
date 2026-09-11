#!/usr/bin/env node
/**
 * 消费项目自诊断：只用发布入口 `@graphvideo/sdk/analysis` 对自身插件 Node
 * 建因果索引并查询。只读实例描述，不创建生产 Runtime、不启动应用。
 * 查询语义与原仓库 `npm run trace` 的同名基础命令一致；视图命令
 *（chain/reach/health/cluster）需自备 analysis 视图后另行扩展。
 */
import {
  buildCausalIndex,
  expandEntity,
  findCausalChain,
  queryEntity,
  selectInducedSubgraph,
  validateCausalIndex,
} from '@graphvideo/sdk/analysis'
import plugin from '../plugins/hello-counter/backend.mjs'
import { frontendLinks, frontendServiceLinks } from '../analysis/links.mjs'

const index = buildCausalIndex({
  nodeObjects: plugin.createNodes({}),
  frontendLinks,
  frontendServiceLinks,
})

const [command = 'help', ...rest] = process.argv.slice(2)
const out = (data) => console.log(JSON.stringify(data, null, 2))

function requireEntity(address) {
  const entity = queryEntity(index, address)
  if (!entity) throw new Error(`Entity not found: ${address}`)
  return entity
}

switch (command) {
  case 'node': {
    const nodeId = rest[0]
    if (!nodeId) {
      out({
        totalNodeCount: index.nodes.size,
        nodeIds: Array.from(index.nodes.keys()),
      })
      break
    }
    const entity = requireEntity(`node:${nodeId}`)
    out({ node: entity, expanded: expandEntity(index, entity.address) })
    break
  }
  case 'change':
  case 'info':
  case 'state': {
    const key = rest[0]
    if (!key) throw new Error(`Usage: ${command} <address>`)
    const address = key.startsWith(`${command}:`) ? key : `${command}:${key}`
    out({ entity: requireEntity(address), expanded: expandEntity(index, address) })
    break
  }
  case 'expand': {
    const address = rest[0]
    if (!address) throw new Error('Usage: expand <address>')
    out(requireEntity(address) && expandEntity(index, address))
    break
  }
  case 'path': {
    if (rest.length < 2) throw new Error('Usage: path <address> <address>')
    out(findCausalChain(index, rest, { maxPaths: 10, maxDepth: 15 }))
    break
  }
  case 'select': {
    if (rest.length === 0) throw new Error('Usage: select <nodeId...>')
    out(selectInducedSubgraph(index, rest))
    break
  }
  case 'frontend': {
    out({
      frontendLinkCount: index.frontendLinks.length,
      frontendLinks: index.frontendLinks,
      entries: Array.from(index.entries.values()),
    })
    break
  }
  case 'validate': {
    const report = validateCausalIndex(index)
    out({ valid: report.valid, issueCount: report.issues.length, issues: report.issues })
    if (!report.valid) process.exitCode = 1
    break
  }
  default:
    console.log(`diagnose <node|change|info|state|expand|path|select|frontend|validate> [args]`)
    break
}
