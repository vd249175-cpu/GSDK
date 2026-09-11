import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dll = resolve(root, 'target', 'debug', 'graphvideo_kernel_node.dll');
const outDir = resolve(root, 'crates', 'kernel-node');
const out = resolve(outDir, 'graphvideo-kernel-node.win32-x64-msvc.node');

if (!existsSync(dll)) {
  throw new Error(
    `Missing cdylib: run 'cargo build -p graphvideo-kernel-node' first (looked at ${dll})`,
  );
}
mkdirSync(outDir, { recursive: true });
copyFileSync(dll, out);
console.log(`native binding staged at ${out}`);
