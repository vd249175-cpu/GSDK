import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * renderer 边界检查：renderer 只能消费发布包的 UI 入口，
 * 不得混入 Kernel 执行、Node.js 分析依赖与主进程模块。
 */
const root = dirname(fileURLToPath(import.meta.url))
const rendererDir = join(root, '..', 'renderer', 'src')

const forbiddenImports = [
  '@graphvideo/sdk/testing',
  '@graphvideo/sdk/analysis',
  '@graphvideo/backend-sdk',
  'core/src',
  'node:',
  'node:fs',
  'node:path',
  'node:child_process',
]

const forbiddenSymbols = [
  'KernelRuntime',
  'EffectAdapter',
  'createTestRuntime',
]

function collect(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...collect(full))
    } else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\.(tsx?|jsx?)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

let failed = false
for (const file of collect(rendererDir)) {
  const text = readFileSync(file, 'utf8')
  
  // 检查 forbiddenSymbols
  for (const token of forbiddenSymbols) {
    if (text.includes(token)) {
      console.error(`[boundary] ${file} 引用了禁止运行时符号: ${token}`)
      failed = true
    }
  }

  // 检查 import/require 形式的 forbiddenImports
  for (const token of forbiddenImports) {
    const importRegex = new RegExp(`(?:from|import|require)\\s*['"\`].*${token.replace(':', '\\:')}.*['"\`]`)
    if (importRegex.test(text)) {
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
