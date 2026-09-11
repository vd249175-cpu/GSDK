#!/usr/bin/env node
/**
 * graphvideo-init: 冷启动命令，用本包自带的 init-bundle 创建最小本地应用。
 * 只依赖 node 内置模块；模板、文档、安装包均来自 init-bundle/，除 react 系
 * 常规依赖外无需 registry 上的 @graphvideo/*（bundle 内 tarball 本地满足，
 * 含 peer 的 kernel 同事务装入，不触发外网解析）。
 *
 * 用法：
 *   graphvideo-init <目标目录> [--name <包名>] [--skip-install] [--help]
 *
 * 目标目录必须不存在、为空，或仅含脚手架三件套（package.json / package-lock.json
 * / node_modules，此时配合 --skip-install 复用已装依赖）。
 */
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundleDir = join(pkgRoot, 'init-bundle')
const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
const npmRun = existsSync(npmCli)
  ? (args, options) => execFileSync(process.execPath, [npmCli, ...args], { ...options })
  : (args, options) => execFileSync('npm', args, { shell: true, ...options })

const usage = [
  '用法：graphvideo-init <目标目录> [--name <包名>] [--skip-install]',
  '  <目标目录>  不存在 / 为空 / 仅含脚手架三件套均可',
  '  --name      写入目标 package.json 的包名（默认 hello-graphvideo）',
  '  --skip-install  跳过依赖安装（目标已装好四包时用）',
  '示例：',
  '  mkdir my-app && cd my-app && npm init -y',
  '  npm install /path/to/delivery/packages/*.tgz',
  '  npx graphvideo-init . --skip-install && npm install && npm run verify',
].join('\n')

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(usage)
  process.exit(0)
}
const skipInstall = args.includes('--skip-install') || args.includes('--no-install')
const nameIdx = args.indexOf('--name')
const nameValue = nameIdx >= 0 ? args[nameIdx + 1] : undefined
const appName = nameValue ?? 'hello-graphvideo'
const targetPos = args.find((a) => !a.startsWith('--') && a !== nameValue)
if (!targetPos) {
  console.error(usage)
  process.exit(1)
}
const targetDir = resolve(targetPos)

// 0. 自检：bundle 齐全才动手，不静默降级。
const templateDir = join(bundleDir, 'template')
const docsDir = join(bundleDir, 'docs')
const tarballDir = join(bundleDir, 'tarballs')
const tarballs = existsSync(tarballDir)
  ? readdirSync(tarballDir).filter((f) => f.endsWith('.tgz')).map((f) => join(tarballDir, f))
  : []
const missing = [
  !existsSync(join(templateDir, 'package.json')) && 'template/',
  !existsSync(join(docsDir, 'AGENTS.md')) && 'docs/AGENTS.md',
  !existsSync(join(docsDir, 'DOCUMENTS/mental-model.md')) && 'docs/DOCUMENTS/',
  tarballs.length < 4 && 'tarballs/*.tgz（需四包）',
  !tarballs.some((f) => /graphvideo-sdk-.+\.tgz$/.test(f)) && 'tarballs/graphvideo-sdk-*.tgz',
].filter(Boolean)
if (missing.length > 0) {
  console.error(`[init] 此 @graphvideo/sdk 包不含完整 init-bundle（缺：${missing.join('、')}），请用仓库 npm run export:sdk 重新打包`)
  process.exit(1)
}

// 1. 目标目录校验。
const SCAFFOLD_ONLY = new Set(['package.json', 'package-lock.json', 'node_modules'])
if (existsSync(targetDir)) {
  if (!statSync(targetDir).isDirectory()) throw new Error(`[init] 目标不是目录：${targetDir}`)
  const entries = readdirSync(targetDir)
  const foreign = entries.filter((e) => !SCAFFOLD_ONLY.has(e))
  if (foreign.length > 0) throw new Error(`[init] 目标目录非空，拒绝覆盖：${foreign.slice(0, 5).join('、')}……请换空目录`)
} else {
  mkdirSync(targetDir, { recursive: true })
}

// 2. 落模板与文档（AGENTS.md / DOCUMENTS / .agents 与模板同级，路径引用开箱即用）。
cpSync(templateDir, targetDir, { recursive: true })
for (const entry of readdirSync(docsDir)) {
  cpSync(join(docsDir, entry), join(targetDir, entry), { recursive: true })
}

// 3. 包名。
const manifestPath = join(targetDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.name = appName
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

// 4. 装包：四个 tarball 一次事务，实体目录安装、单副本，不碰外网 @graphvideo/*。
// 不得加 pkgRoot：目录安装产生 symlink，双副本会冲掉 kernel 单例 capability。
if (!skipInstall) {
  npmRun(['install', '--no-audit', '--no-fund', ...tarballs], { cwd: targetDir, stdio: 'inherit' })
}

console.log(`[init] done -> ${targetDir}`)
console.log('下一步：')
if (skipInstall) console.log('  npm install   # 补 react / vite / electron 等常规依赖')
console.log('  npm run verify   # 边界 + 类型 + 测试 + 自诊断 + 构建')
console.log('  npm run diagnose -- validate   # 只读因果自检，不启动应用')
