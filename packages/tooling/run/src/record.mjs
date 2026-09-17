import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Writes the parsed active-run snapshot: identity, loopback endpoint, config
 * and completed lifecycle stages. Stop reads this file, so edits to
 * run.config.json mid-run cannot redirect shutdown at another process.
 */
export function writeSnapshotRecord(runtimeDirectory, snapshot) {
  mkdirSync(runtimeDirectory, { recursive: true });
  const path = join(runtimeDirectory, 'config-snapshot.json');
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return path;
}

export function appendStageLog(logsDirectory, runName, line) {
  mkdirSync(logsDirectory, { recursive: true });
  const path = join(logsDirectory, `${runName}.stages.log`);
  writeFileSync(path, `${new Date().toISOString()} ${line}\n`, { flag: 'a' });
  return path;
}
