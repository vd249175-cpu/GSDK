#!/usr/bin/env node
/**
 * 演示拓扑外部命令发送器：起第二个 Electron 实例，把 argv 转交给已运行的
 * 主实例（single-instance），自己随即退出。能 admit 什么取决于 main 侧
 * 有什么代码，这里只透传参数，不做任何决策。
 * 用法：npm run demo:op -- --demo-admit=demo.fraud
 *      npm run demo:op -- --demo-evict=demo.inventory
 *      npm run demo:op -- --demo-reset
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('用法：demo:op -- --demo-admit=<id> | --demo-evict=<id> | --demo-reset')
  process.exit(1)
}
const result = spawnSync(electronPath, [appDir, ...args], { stdio: 'inherit' })
process.exit(result.status ?? 1)
