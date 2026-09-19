import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.argv.includes('--release') ? 'release' : 'debug';
const platform = process.platform;
const arch = process.arch;
const sourceName = platform === 'win32'
  ? 'graphframework_kernel_node.dll'
  : platform === 'darwin'
    ? 'libgraphframework_kernel_node.dylib'
    : platform === 'linux'
      ? 'libgraphframework_kernel_node.so'
      : null;
const platformTag = platform === 'win32'
  ? `win32-${arch}-msvc`
  : platform === 'linux'
    ? `linux-${arch}-gnu`
    : platform === 'darwin'
      ? `darwin-${arch}`
      : null;
if (!sourceName || !platformTag) throw new Error(`Unsupported native target: ${platform}-${arch}`);
const library = resolve(root, 'target', profile, sourceName);
const outDir = resolve(root, 'kernel-node');
const out = resolve(outDir, `graphframework-kernel-node.${platformTag}.node`);

if (!existsSync(library)) {
  throw new Error(
    `Missing cdylib: build graphframework-kernel-node first (looked at ${library})`,
  );
}
mkdirSync(outDir, { recursive: true });
copyFileSync(library, out);
console.log(`native binding (${profile}) staged at ${out}`);
