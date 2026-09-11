import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const electron = require('electron')
const platformTag = process.platform === 'win32'
  ? `win32-${process.arch}-msvc`
  : process.platform === 'linux'
    ? `linux-${process.arch}-gnu`
    : process.platform === 'darwin'
      ? `darwin-${process.arch}`
      : null
if (!platformTag) throw new Error(`Unsupported native target: ${process.platform}-${process.arch}`)
const binding = resolve(root, 'crates', 'kernel-node', `graphvideo-kernel-node.${platformTag}.node`)
if (!existsSync(binding)) throw new Error(`Native binding missing: ${binding}`)
const smoke = resolve(root, 'scripts', 'electron-native-smoke.cjs')
const result = spawnSync(electron, [smoke], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', GRAPHVIDEO_NATIVE_NODE: binding },
})
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`Electron native smoke exited ${result.status}`)
