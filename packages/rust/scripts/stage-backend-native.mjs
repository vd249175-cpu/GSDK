import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const platformTag = process.platform === 'win32'
  ? `win32-${process.arch}-msvc`
  : process.platform === 'linux'
    ? `linux-${process.arch}-gnu`
    : process.platform === 'darwin'
      ? `darwin-${process.arch}`
      : null
if (!platformTag) throw new Error(`Unsupported native target: ${process.platform}-${process.arch}`)
const source = resolve(
  root,
  'kernel-node',
  `graphframework-kernel-node.${platformTag}.node`,
)
if (!existsSync(source)) throw new Error(`Staged native binding missing: ${source}`)
const nativeDir = resolve(root, '../sdk/javascript/dist/native')
mkdirSync(nativeDir, { recursive: true })
const destination = resolve(nativeDir, `graphframework-kernel-node.${platformTag}.node`)
copyFileSync(source, destination)
console.log(`backend runtime native binding staged at ${destination}`)
