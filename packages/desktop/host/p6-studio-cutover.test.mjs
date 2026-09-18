import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('P6 Studio run cutover guards', () => {
  it('uses the authenticated run frontend host without embedding a kernel', () => {
    const source = readFileSync(
      join(repoRoot, 'app', 'plugins', 'frontend', 'graphvideo.studio', 'desktop', 'main.mjs'), 'utf8',
    );
    expect(source).toContain('connectFrontendHost');
    expect(source).not.toContain('NativeRuleSpace');
    expect(source).not.toContain('NativeGraphHost');
  });

  it('removes legacy Electron startup and refuses implicit application assembly', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'packages', 'desktop', 'package.json'), 'utf8'));
    expect(manifest.scripts['start:legacy-electron']).toBeUndefined();
    expect(manifest.scripts.prestart).toBeUndefined();
    expect(manifest.scripts.start).not.toContain('electron .');
    expect(readFileSync(join(repoRoot, 'packages/desktop/host/main.mjs'), 'utf8')).toContain('bash ./run.sh start');
  });
});
