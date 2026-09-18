import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('P6 Studio run cutover guards', () => {
  it('refuses to boot an embedded kernel when the run daemon owns the graph', () => {
    const source = readFileSync(
      join(repoRoot, 'app', 'plugins', 'graphvideo.studio', 'desktop', 'main.mjs'), 'utf8',
    );
    expect(source).toContain('GRAPHVIDEO_RUN_DAEMON_ADDRESS');
    expect(source).toContain('must not boot an embedded NativeRuleSpace');
  });

  it('keeps the old interactive entry as an explicit non-default script', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'packages', 'desktop', 'package.json'), 'utf8'));
    expect(manifest.scripts['start:legacy-electron']).toContain('electron');
    expect(manifest.scripts.start).not.toContain('electron .');
  });
});
