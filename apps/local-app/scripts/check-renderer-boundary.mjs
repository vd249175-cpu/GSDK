import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * renderer 边界检查：renderer 只能消费发布包的 UI 入口，
 * 不得混入 Kernel 执行、Node.js 分析依赖与主进程模块。
 */
const root = dirname(fileURLToPath(import.meta.url))
const rendererDir = join(root, '..', 'renderer', 'src')

const forbidden = [
  '@graphvideo/kernel',
  '@graphvideo/sdk/testing',
  '@graphvideo/sdk/analysis',
  '@graphvideo/backend-sdk',
  'core/src',
  'node:',
  'node:fs',
  'node:path',
  'node:child_process',
  'EffectAdapter',
  'createTestRuntime',
  'KernelRuntime',
  // renderer 不得指定任意目标：只能调用 preload 暴露的固定命令。
  'targetNodeId',
  'graph/inject',
  'graph/read',
]

function collect(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collect(full))
    else if (/\.(tsx?|jsx?|css)$/.test(entry)) out.push(full)
  }
  return out
}

let failed = false
for (const file of collect(rendererDir)) {
  const text = readFileSync(file, 'utf8')
  for (const token of forbidden) {
    if (text.includes(token)) {
      console.error(`[boundary] ${file} 引用了禁止依赖: ${token}`)
      failed = true
    }
  }
}

if (failed) {
  console.error('[boundary] renderer 边界检查失败')
  process.exit(1)
}
console.log('[boundary] renderer 边界检查通过')
