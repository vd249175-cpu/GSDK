import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Writes the parsed active-run snapshot: identity, loopback endpoint, config
 * and completed lifecycle stages. Stop reads this file, so edits to
 * run.config.json mid-run cannot redirect shutdown at another process.
 */
export function writeSnapshotRecord(runtimeDirectory, snapshot) {
  mkdirSync(runtimeDirectory, { recursive: true });
  const path = join(runtimeDirectory, 'config-snapshot.json');
  writeJsonRecord(path, snapshot);
  return path;
}

export function writeJsonRecord(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.next`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  // Windows readers/antivirus may briefly deny replacement; never truncate
  // the committed record or expose an incomplete JSON document.
  const deadline = Date.now() + 1000;
  for (;;) {
    try { renameSync(temporary, path); break; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}

export function appendStageLog(logsDirectory, runName, line) {
  mkdirSync(logsDirectory, { recursive: true });
  const path = join(logsDirectory, `${runName}.stages.log`);
  writeFileSync(path, `${new Date().toISOString()} ${line}\n`, { flag: 'a' });
  return path;
}
