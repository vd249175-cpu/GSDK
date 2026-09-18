import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { statusRun, stopRun } from '../../tooling/run/src/session.mjs';

/** Preserve credentials and evidence whenever an owned test run cannot stop. */
export async function cleanupRunFixtures(roots) {
  for (const root of roots.splice(0)) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const config = join(root, entry.name, 'run.config.json');
      if (statusRun(config).active) await stopRun(config);
    }
    rmSync(root, { recursive: true, force: true });
  }
}
