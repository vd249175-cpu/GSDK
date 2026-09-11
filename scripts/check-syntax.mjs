#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

console.log('🔍 [GSDK 静态语法与代码质量检查]\n')

// 1. Oxlint 静态 AST 与语法分析 (Rust 引擎)
console.log('1️⃣ 运行 Oxlint 静态语法分析...')
try {
  const oxlintOutput = execFileSync(
    'npx',
    ['oxlint', '--deny=error'],
    { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  )
  console.log('   ✅ Oxlint 静态语法检查通过')
  if (oxlintOutput.trim()) {
    const lines = oxlintOutput.trim().split('\n')
    console.log(`   ℹ️ ${lines.slice(-2).join(' ')}`)
  }
} catch (err) {
  const output = err.stdout || err.stderr || err.message
  console.error('   ❌ Oxlint 发现语法错误:\n', output)
  errors.push({ tool: 'oxlint', message: output })
}

// 2. ESM 相对导入完整性与扩展名静态检查
console.log('\n2️⃣ 扫描 Node ESM 相对导入完整性与扩展名规范...')

function scanDirectory(dir, fileList = []) {
  if (!existsSync(dir)) return fileList
  const entries = readdirSync(dir)
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'renderer-dist') continue
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      scanDirectory(fullPath, fileList)
    } else if (/\.(mjs|js|ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      fileList.push(fullPath)
    }
  }
  return fileList
}

const targetDirs = [
  join(root, 'apps/local-app/src-main'),
  join(root, 'apps/local-app/plugins'),
  join(root, 'core/src'),
  join(root, 'sdk'),
  join(root, 'scripts'),
]

let filesChecked = 0
const importRegex = /(?:import|export)\s+(?:(?:(?:\*|[\w{}\s,]+)\s+from\s+)?['"](\.[^'"]+)['"]|['"](\.[^'"]+)['"])/g

for (const dir of targetDirs) {
  const files = scanDirectory(dir)
  for (const file of files) {
    filesChecked++
    const isNodeMjs = file.endsWith('.mjs')
    const content = readFileSync(file, 'utf8')
    let match

    while ((match = importRegex.exec(content)) !== null) {
      const specifier = match[1] || match[2]
      if (!specifier) continue

      const fileDir = dirname(file)
      const targetPath = resolve(fileDir, specifier)

      // Node .mjs 必须带扩展名
      if (isNodeMjs && !extname(specifier)) {
        errors.push({
          tool: 'esm-extension-check',
          file: file.replace(root + '/', ''),
          message: `Node 原生 ESM 文件禁止使用无扩展名导入: "${specifier}" (必须显式包含 .js 或 .mjs 扩展名)`,
        })
      }

      // 检查目标文件在磁盘上是否存在
      const existsDirect = existsSync(targetPath) && !statSync(targetPath).isDirectory()
      const existsWithExt = ['.js', '.mjs', '.ts', '.tsx', '.json', '.d.mts', '.d.ts', '.mts', '.cjs'].some((ext) => existsSync(`${targetPath}${ext}`))
      const existsIndex = ['.js', '.mjs', '.ts', '.tsx'].some((ext) => existsSync(join(targetPath, `index${ext}`)))
      const strippedTarget = targetPath.replace(/\.(mjs|js)$/, '')
      const existsStripped = ['.d.mts', '.d.ts', '.ts', '.tsx'].some((ext) => existsSync(`${strippedTarget}${ext}`))

      if (!existsDirect && !existsWithExt && !existsIndex && !existsStripped) {
        errors.push({
          tool: 'esm-import-check',
          file: file.replace(root + '/', ''),
          message: `无法解析的导入目标: "${specifier}" -> 路径不存在: ${targetPath}`,
        })
      }
    }

    // 检查命名导入 (named imports) 是否确实在目标模块中导出
    const namedImportRegex = /(?:import|export)\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g
    let namedMatch
    while ((namedMatch = namedImportRegex.exec(content)) !== null) {
      const symbolsRaw = namedMatch[1]
      const specifier = namedMatch[2]
      if (!specifier) continue

      const fileDir = dirname(file)
      let resolvedTarget = resolve(fileDir, specifier)
      if (!existsSync(resolvedTarget) || statSync(resolvedTarget).isDirectory()) {
        for (const ext of ['.mjs', '.js', '.ts', '.tsx']) {
          if (existsSync(`${resolvedTarget}${ext}`)) {
            resolvedTarget = `${resolvedTarget}${ext}`
            break
          }
        }
      }

      if (existsSync(resolvedTarget) && !statSync(resolvedTarget).isDirectory()) {
        const targetContent = readFileSync(resolvedTarget, 'utf8')
        // 如果有通配符重导出 export * from，跳过精确断言
        if (/export\s*\*\s*from/.test(targetContent)) continue

        const exportedNames = new Set()
        let expMatch
        const declRegex = /export\s+(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|type|interface)\s+([a-zA-Z0-9_$]+)/g
        while ((expMatch = declRegex.exec(targetContent)) !== null) {
          exportedNames.add(expMatch[1])
        }
        const namedExpRegex = /export\s*\{([^}]+)\}/g
        while ((expMatch = namedExpRegex.exec(targetContent)) !== null) {
          for (const item of expMatch[1].split(',')) {
            const parts = item.trim().split(/\s+as\s+/)
            const expName = parts[1]?.trim() || parts[0]?.trim()
            if (expName) exportedNames.add(expName)
          }
        }

        const importedSymbols = symbolsRaw.split(',').map((s) => {
          const parts = s.trim().split(/\s+as\s+/)
          return parts[0]?.trim()
        }).filter(Boolean)

        for (const sym of importedSymbols) {
          // 忽略类型导入 import type
          if (sym.startsWith('type ')) continue
          if (exportedNames.size > 0 && !exportedNames.has(sym)) {
            errors.push({
              tool: 'esm-named-export-check',
              file: file.replace(root + '/', ''),
              message: `模块 "${specifier}" 未导出标识符 "${sym}" (已导出: ${Array.from(exportedNames).slice(0, 8).join(', ')}...)`,
            })
          }
        }
      }
    }
  }
}

console.log(`   ✅ 检查了 ${filesChecked} 个源文件的导入完整性与命名导出匹配`)

// 3. Node 原生语法快速校验 (node --check)
console.log('\n3️⃣ 校验主进程与脚本的 Node 原生语法...')
const mainFiles = scanDirectory(join(root, 'apps/local-app/src-main'))
  .concat(scanDirectory(join(root, 'scripts')))
  .filter((f) => f.endsWith('.mjs') || f.endsWith('.cjs') || f.endsWith('.js'))

let syntaxChecked = 0
for (const file of mainFiles) {
  try {
    execFileSync('node', ['--check', file], { stdio: 'pipe' })
    syntaxChecked++
  } catch (err) {
    errors.push({
      tool: 'node-check',
      file: file.replace(root + '/', ''),
      message: err.stderr?.toString() || err.message,
    })
  }
}
console.log(`   ✅ 校验了 ${syntaxChecked} 个 JS/MJS 文件的原生语法`)

// 4. 输出汇总与结果
console.log('\n========================================')
if (errors.length > 0) {
  console.error(`❌ 静态检查未通过，共发现 ${errors.length} 个错误:`)
  for (const err of errors) {
    if (err.file) {
      console.error(`  - [${err.tool}] ${err.file}: ${err.message}`)
    } else {
      console.error(`  - [${err.tool}]: ${err.message}`)
    }
  }
  process.exit(1)
} else {
  console.log('🎉 所有静态语法检查与模块解析 100% 通过！代码质量处于健康状态。')
  console.log('========================================\n')
  process.exit(0)
}
