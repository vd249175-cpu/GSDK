#!/usr/bin/env node
/**
 * scripts/export-packages.mjs
 * 完整开发交付：build:sdk → npm pack ×4 → 交付目录（含 AGENTS、Skills、
 * DOCUMENTS、本地应用模板、tarballs、交付清单）→ 仓外双验收（后端 smoke +
 * 模板消费 verify）。只有全部成功才报告导出成功。
 *
 * 用法：npm run export:sdk [-- --target <dir>]（默认 dist/delivery）。
 * 产物生命周期：根 dist/ 由生产构建（vite build，emptyOutDir）与本导出共享；
 * 两者顺序执行，生产构建会清空 dist/packages 与 dist/delivery，之后需重导出。
 * 本脚本内各阶段严格串行，禁止与生产构建并行。
 *
 * 冲突规则：目标已含 delivery-manifest.json 时，与上次清单比对；用户改动过
 * 的文件（内容与清单记录不一致）予以保留并报告，不静默覆盖；其余更新。
 * 交付集合固定（下文 STAGED），用户项目、凭据、本机配置默认不在集合内。
 */
import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
const npmRun = existsSync(npmCli)
  ? (args, options) => execFileSync(process.execPath, [npmCli, ...args], { ...options })
  : (args, options) => execFileSync('npm', args, { shell: true, ...options })
const git = (args) => {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}
/**
 * 清单路径收敛：拒绝绝对路径与 `../` 逃逸。旧清单不可信（用户可改），
 * 任何读取/hash/删除前必须经此收敛，返回 null 表示越界并跳过。
 */
const resolveWithin = (base, rel) => {
  if (typeof rel !== 'string' || rel === '' || isAbsolute(rel)) return null
  const absolute = resolve(base, rel)
  if (absolute !== base && !absolute.startsWith(base + sep)) return null
  return absolute
}

const targetArg = process.argv.indexOf('--target')
const targetDir = targetArg >= 0 && process.argv[targetArg + 1]
  ? resolve(process.argv[targetArg + 1])
  : join(root, 'dist', 'delivery')

/** 交付集合：[仓库相对源, 目标相对路径, 目录?] */
const STAGED = [
  ['AGENTS.md', 'AGENTS.md', false],
  ['.agents/skills/causal-graph-diagnostics', '.agents/skills/causal-graph-diagnostics', true],
  ['.agents/skills/theme-color-management', '.agents/skills/theme-color-management', true],
  ['DOCUMENTS', 'DOCUMENTS', true],
  ['templates/local-app', 'templates/local-app', true],
]

const TEMPLATE_EXCLUDE = new Set(['node_modules', 'renderer-dist', 'dist'])

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function collectFiles(dir, base) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (base === '' && TEMPLATE_EXCLUDE.has(entry)) continue
    const full = join(dir, entry)
    const rel = base ? `${base}/${entry}` : entry
    if (statSync(full).isDirectory()) out.push(...collectFiles(full, rel))
    else out.push({ full, rel })
  }
  return out
}

// 1. 构建与打包（串行）。
execFileSync(process.execPath, [join(root, 'scripts/build-packages.mjs')], { cwd: root, stdio: 'inherit' })

const preSdk = ['core', 'sdk/backend', 'workbench']
const outDir = join(root, 'dist/packages')
mkdirSync(outDir, { recursive: true })
const tarballs = []
for (const dir of preSdk) {
  const packed = npmRun(['pack', '--pack-destination', outDir, '--json'], {
    cwd: join(root, dir), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  })
  const filename = JSON.parse(packed)[0].filename
  tarballs.push({ dir, filename, full: join(outDir, filename) })
  console.log(`[export] packed ${dir} -> ${filename}`)
}

// 1b. 组装 sdk 自带的 init-bundle（模板 + 文档 + sibling tarballs），随 sdk 一起 pack。
// sdk 是冷启动 bin 的唯一载体；bundle 缺失则 bin 直接失败，不静默降级。
const sdkDir = join(root, 'sdk')
const bundleDir = join(sdkDir, 'init-bundle')
rmSync(bundleDir, { recursive: true, force: true })
mkdirSync(join(bundleDir, 'tarballs'), { recursive: true })
for (const { full, filename } of tarballs) cpSync(full, join(bundleDir, 'tarballs', filename))
const templateRoot = join(root, 'templates/local-app')
cpSync(templateRoot, join(bundleDir, 'template'), {
  recursive: true,
  filter: (src) => dirname(src) !== templateRoot || !TEMPLATE_EXCLUDE.has(basename(src)),
})
for (const [source, target, isDir] of STAGED) {
  if (source === 'templates/local-app') continue
  cpSync(join(root, source), join(bundleDir, 'docs', target), { recursive: isDir })
}
{
  const packSdk = () => JSON.parse(npmRun(['pack', '--pack-destination', outDir, '--json'], {
    cwd: sdkDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  }))[0].filename
  // 第一遍只为确定文件名；自拷贝进 bundle 后再打一遍，包内 bundle 才含四包。
  const first = packSdk()
  tarballs.push({ dir: 'sdk', filename: first, full: join(outDir, first) })
  console.log(`[export] packed sdk -> ${first}`)
  // bin 只装 tarballs（目录安装会产生 symlink 双副本，冲掉单例 capability）。
  // sdk 自身 tarball 也进 bundle，凑齐四包同事务。
  cpSync(join(outDir, first), join(bundleDir, 'tarballs', first))
  const filename = packSdk()
  tarballs[tarballs.length - 1] = { dir: 'sdk', filename, full: join(outDir, filename) }
  console.log(`[export] repacked sdk with self tarball -> ${filename}`)
}

// 2. 必需资源存在性检查（缺失即失败，不产出半份交付）。
for (const [source] of STAGED) {
  if (!existsSync(join(root, source))) throw new Error(`[export] 缺少必需交付资源: ${source}`)
}

// 3. 载入上次清单，判定冲突。
// 双 hash 语义：sha256 = 工具基线（上次工具写入的内容摘要），currentSha256 =
// 上次观测到的目标文件摘要。规则只有一条：目标现状与基线一致才覆盖，否则
// 保留并沿用基线——用户改动永不洗成基线，可跨任意次导出保留；用户把文件改
// 回与基线一致后，下一轮自动恢复同步。旧清单（无 currentSha256 且状态为
// preserved-user-change）的 sha256 存的是用户 hash，首轮一律保留并把基线
// 收敛为当前工具摘要，之后按新规则走。
const manifestPath = join(targetDir, 'delivery-manifest.json')
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
const previousEntries = new Map((previous?.files ?? []).map((f) => [f.path, f]))
mkdirSync(targetDir, { recursive: true })
const stagedFiles = []
const preserved = []
const stageOne = (sourceRel, targetRel, isDir) => {
  const source = join(root, sourceRel)
  const target = join(targetDir, targetRel)
  const items = isDir
    ? collectFiles(source, '').map(({ full, rel }) => ({ full, rel: `${targetRel}/${rel}` }))
    : [{ full: source, rel: targetRel }]
  for (const { full, rel } of items) {
    const destination = join(targetDir, rel)
    const content = readFileSync(full)
    const digest = createHash('sha256').update(content).digest('hex')
    const prev = previousEntries.get(rel)
    const legacyPreserved = prev?.status === 'preserved-user-change' && prev.currentSha256 === undefined
    if (prev && existsSync(destination) && (legacyPreserved || sha256File(destination) !== prev.sha256)) {
      const baseline = legacyPreserved ? digest : prev.sha256
      preserved.push(rel)
      stagedFiles.push({ path: rel, sha256: baseline, source: sourceRel, status: 'preserved-user-change', currentSha256: sha256File(destination) })
      continue
    }
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, content)
    stagedFiles.push({ path: rel, sha256: digest, source: sourceRel, status: 'exported', currentSha256: digest })
  }
}
for (const [source, target, isDir] of STAGED) stageOne(source, target, isDir)

// tarballs 始终更新（构建产物，不参与用户修改保留）。
const packageRecords = []
for (const { filename, full } of tarballs) {
  const destination = join(targetDir, 'packages', filename)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, readFileSync(full))
  packageRecords.push({ file: `packages/${filename}`, sha256: sha256File(destination) })
}
for (const { dir, filename } of tarballs) {
  const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
  const record = packageRecords.find((p) => p.file === `packages/${filename}`)
  record.name = manifest.name
  record.version = manifest.version
}
// 3b. 退役清理：上次工具管理、本轮消失的文件。内容仍等于工具基线 →
// 安全删除；用户改过 → 保留并报告冲突，永不静默删用户数据。
// 旧清单条目用 recorded sha256 作基线近似（新条目即精确基线）。
// retired-user-change 条目跨轮保留在清单里（P3 追踪），直到文件被用户删除。
const removed = []
const retiredConflict = []
if (previous) {
  const managedNow = new Set([...stagedFiles.map((f) => f.path), ...packageRecords.map((p) => p.file)])
  const managedBefore = new Map([
    ...(previous.files ?? []).map((f) => [f.path, f]),
    ...(previous.packages ?? []).map((p) => [p.file, { sha256: p.sha256 }]),
  ])
  for (const [rel, recorded] of managedBefore) {
    if (managedNow.has(rel)) continue
    const destination = resolveWithin(targetDir, rel)
    if (!destination) {
      console.log(`[export]   retired-skipped（清单路径越界，已忽略）: ${rel}`)
      continue
    }
    if (!existsSync(destination)) {
      if (recorded?.status === 'retired-user-change') console.log(`[export]   retired-gone（用户已删，不再追踪）: ${rel}`)
      continue
    }
    if (recorded?.status === 'retired-user-change') {
      const observed = sha256File(destination)
      retiredConflict.push(rel)
      stagedFiles.push({ path: rel, sha256: recorded.sha256, source: recorded.source ?? 'retired', status: 'retired-user-change', currentSha256: observed })
      continue
    }
    if (sha256File(destination) === recorded?.sha256) {
      rmSync(destination, { force: true })
      removed.push(rel)
    } else {
      const observed = sha256File(destination)
      retiredConflict.push(rel)
      stagedFiles.push({ path: rel, sha256: recorded?.sha256, source: recorded?.source ?? 'retired', status: 'retired-user-change', currentSha256: observed })
    }
  }
  for (const rel of removed) console.log(`[export]   retired-removed: ${rel}`)
  for (const rel of retiredConflict) console.log(`[export]   retired-conflict（用户改过，保留并继续追踪）: ${rel}`)
}
// 4. 交付清单（仅交付元数据，不进入运行时 State）。
const manifest = {
  tool: 'scripts/export-packages.mjs',
  createdAt: new Date().toISOString(),
  gitRev: git('rev-parse HEAD'),
  worktreeStatus: git('status --short'),
  target: targetDir,
  packages: packageRecords,
  files: stagedFiles,
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[export] staged -> ${targetDir} (${stagedFiles.length} files, ${packageRecords.length} tarballs)`)
if (preserved.length > 0) {
  console.log(`[export] 保留用户改动 ${preserved.length} 个，未覆盖:`)
  for (const rel of preserved) console.log(`[export]   preserved: ${rel}`)
} else if (previous) {
  console.log('[export] 重复导出：目标无用户改动，清单已刷新')
}

// 5a. 验收一：后端公开入口 smoke（交付物 tarballs）。
const acceptDir = mkdtempSync(join(tmpdir(), 'graphvideo-sdk-accept-'))
try {
  writeFileSync(join(acceptDir, 'package.json'), JSON.stringify({ name: 'sdk-accept', private: true, type: 'module' }))
  npmRun(['install', '--no-audit', '--no-fund',
    ...packageRecords.map((p) => join(targetDir, p.file))], { cwd: acceptDir, stdio: 'inherit' })
  writeFileSync(join(acceptDir, 'smoke.mjs'), `import assert from 'node:assert/strict'
import { Node } from '@graphvideo/kernel'
import { defineBackendPlugin } from '@graphvideo/backend-sdk'
import { createTestRuntime } from '@graphvideo/sdk/testing'
import { buildCausalIndex, validateCausalIndex } from '@graphvideo/sdk/analysis'
import { parseStudioPluginManifest } from '@graphvideo/sdk/contract'

class CounterNode extends Node {
  constructor() { super('example.counter', 'Counter', { count: 0 }) }
  change(info, ctx) {
    if (info.type === 'IncrementInfo') ctx.patchState({ count: ctx.read('count') + 1 })
  }
}
const plugin = defineBackendPlugin({ id: 'example.accept', createNodes: () => [new CounterNode()] })
const manifest = parseStudioPluginManifest({
  id: plugin.id, name: 'Accept', version: '1.0.0', apiVersion: 1,
  contributes: { elements: [], workspaces: [] },
})
assert.equal(manifest.id, 'example.accept')
const runtime = createTestRuntime({ nodes: plugin.createNodes({}) })
runtime.inject({ targetNodeId: 'example.counter', info: { type: 'IncrementInfo' } })
await runtime.waitForQuiescence()
assert.equal(runtime.getState('example.counter').count, 1)
const report = validateCausalIndex(buildCausalIndex({ nodeObjects: plugin.createNodes({}) }))
assert.equal(report.valid, true)
runtime.dispose()
console.log('[accept] SDK tarballs OK')
`)
  execFileSync(process.execPath, [join(acceptDir, 'smoke.mjs')], { cwd: acceptDir, stdio: 'inherit' })
} finally {
  rmSync(acceptDir, { recursive: true, force: true })
}

// 5b. 验收二：模板消费 verify（仅凭交付目录）。
const consumerDir = mkdtempSync(join(tmpdir(), 'graphvideo-consumer-accept-'))
try {
  cpSync(join(targetDir, 'templates/local-app'), consumerDir, { recursive: true })
  npmRun(['install', '--no-audit', '--no-fund',
    ...packageRecords.map((p) => join(targetDir, p.file))], { cwd: consumerDir, stdio: 'inherit' })
  npmRun(['install', '--no-audit', '--no-fund'], { cwd: consumerDir, stdio: 'inherit' })
  const steps = [
    ['check:renderer-boundary', ['run', 'check:renderer-boundary']],
    ['typecheck', ['run', 'typecheck']],
    ['test', ['run', 'test', '--', '--silent']],
    ['diagnose-validate', ['run', 'diagnose', '--', 'validate']],
    ['build', ['run', 'build']],
  ]
  for (const [name, args] of steps) {
    try {
      npmRun(args, { cwd: consumerDir, stdio: 'inherit' })
    } catch {
      throw new Error(`[export] 消费验收失败于 ${name}，交付未完成`)
    }
  }
  console.log('[accept] consumer template OK')
  // 5c. 验收三：init bin 自包含（四包同事务可装，bin 落点齐全）。
  const loneDir = mkdtempSync(join(tmpdir(), 'graphvideo-lone-sdk-'))
  try {
    writeFileSync(join(loneDir, 'package.json'), JSON.stringify({ name: 'lone-sdk-accept', version: '0.0.0', type: 'module', private: true }))
    npmRun(['install', '--no-audit', '--no-fund', ...tarballs.map((t) => join(targetDir, 'packages', t.filename))], { cwd: loneDir, stdio: 'inherit' })
    const bin = join(loneDir, 'node_modules/@graphvideo/sdk/bin/graphvideo-init.mjs')
    if (!existsSync(bin)) throw new Error('[export] init bin 缺失，交付未完成')
    const initTarget = join(loneDir, 'my-app')
    execFileSync(process.execPath, [bin, initTarget, '--skip-install', '--name', 'init-accept'], { stdio: 'inherit' })
    const initManifest = JSON.parse(readFileSync(join(initTarget, 'package.json'), 'utf8'))
    if (initManifest.name !== 'init-accept') throw new Error('[export] init 包名未写入，交付未完成')
    // 回归：无 --name 时首个位置参数不得被过滤（曾导致直接打印用法并退出）。
    const bareTarget = join(loneDir, 'bare-app')
    execFileSync(process.execPath, [bin, bareTarget, '--skip-install'], { stdio: 'inherit' })
    const bareManifest = JSON.parse(readFileSync(join(bareTarget, 'package.json'), 'utf8'))
    if (bareManifest.name !== 'hello-graphvideo') throw new Error('[export] init 默认包名未写入，交付未完成')
    for (const f of ['AGENTS.md', 'DOCUMENTS/mental-model.md', '.agents/skills/theme-color-management/SKILL.md', 'plugins/hello-counter/backend.mjs', 'renderer/src/app.tsx', 'scripts/diagnose.mjs']) {
      if (!existsSync(join(initTarget, f))) throw new Error(`[export] init 产物缺失：${f}，交付未完成`)
    }
    console.log('[accept] init bin OK')
  } finally {
    rmSync(loneDir, { recursive: true, force: true })
  }
} finally {
  rmSync(consumerDir, { recursive: true, force: true })
}

console.log(`[export] done -> ${targetDir}`)
