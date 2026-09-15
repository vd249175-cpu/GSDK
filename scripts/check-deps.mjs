#!/usr/bin/env node
/**
 * Transitional dependency-direction check (Stage 0 of the package-distribution plan).
 * Reports forbidden cross-boundary imports; does not rewrite anything.
 * Exit 0 when clean, 1 with a violation list otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const violations = [];
const report = (rule, file, line, text) => violations.push({ rule, file, line, text });

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'target', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|cts|mjs|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const roots = ['core', 'sdk', 'tools', 'apps', 'app', 'plugins', 'packages']
  .map((d) => path.join(root, d)).filter((d) => fs.existsSync(d));
const files = roots.flatMap((d) => (fs.statSync(d).isDirectory() ? walk(d) : [d]));

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((text, i) => {
    const m = text.match(/from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/);
    if (!m) return;
    const spec = m[1] ?? m[2];
    if (!spec.startsWith('.')) return;
    const abs = path.normalize(path.join(path.dirname(file), spec)).replace(/\\/g, '/');
    const inTree = (t) => abs === path.join(root, t) || abs.startsWith(path.join(root, t) + path.sep);
    const inRel = (t) => rel.startsWith(t + '/');
    // packages/** must not import app/** or plugins/**
    if (rel.startsWith('packages/') && (abs.includes('/app/') || abs.includes('/plugins/'))) {
      report('packages-must-not-import-app-or-plugins', rel, i + 1, text.trim());
    }
    // packages/** must not reach into apps; legacy trees neither
    if ((inRel('core') || inRel('sdk') || inRel('tools') || inRel('packages')) && inTree('apps')) {
      report('sdk-must-not-import-app', rel, i + 1, text.trim());
    }
    // plugin must not import app internals (apps/local-app/{src-main,renderer}) or another plugin
    if (rel.includes('/plugins/')) {
      if (abs.includes('src-main') || abs.includes('/renderer/')) {
        report('plugin-must-not-import-app-internals', rel, i + 1, text.trim());
      }
      const plugMatch = rel.match(/plugins\/([^/]+)\//);
      const absMatch = path.relative(root, abs).replace(/\\/g, '/').match(/plugins\/([^/]+)\//);
      if (plugMatch && absMatch && plugMatch[1] !== absMatch[1]) {
        report('plugin-must-not-import-another-plugin', rel, i + 1, text.trim());
      }
    }
  });
}

if (violations.length === 0) {
  console.log('dep-check: clean');
} else {
  console.log(`dep-check: ${violations.length} violation(s)`);
  for (const v of violations) console.log(`  [${v.rule}] ${v.file}:${v.line}: ${v.text}`);
  process.exit(1);
}
