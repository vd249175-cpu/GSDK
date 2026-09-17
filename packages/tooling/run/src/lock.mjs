import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function readRecord(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Atomic same-name run lock backed by the run's own runtime directory.
 * Exclusive file creation (`wx`) is atomic on POSIX and Windows, so two
 * starters for the same run name cannot both succeed. The record carries
 * process identity (pid), never just a PID, so stop cannot mistake a stale
 * PID for a live run.
 */
export function acquireRunLock(runtimeDirectory, { runName, pid }) {
  const lockPath = join(runtimeDirectory, 'run.lock.json');
  mkdirSync(dirname(lockPath), { recursive: true });
  const record = { runName, pid, acquiredAt: new Date().toISOString() };
  try {
    writeFileSync(lockPath, JSON.stringify(record), { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const holder = readRecord(lockPath);
      throw new Error(`Run is already active: ${runName} (pid ${holder?.pid ?? 'unknown'})`, { cause: error });
    }
    throw error;
  }
  return {
    path: lockPath,
    release() {
      const holder = readRecord(lockPath);
      if (holder?.pid === pid) rmSync(lockPath, { force: true });
    },
  };
}

export function readRunLock(runtimeDirectory) {
  return readRecord(join(runtimeDirectory, 'run.lock.json'));
}

function activeRecordPath(runtimeDirectory) {
  return join(runtimeDirectory, 'active-run.json');
}

/** Persists the resolved active-run snapshot; stop always uses this snapshot. */
export function writeActiveRecord(runtimeDirectory, record) {
  mkdirSync(runtimeDirectory, { recursive: true });
  writeFileSync(activeRecordPath(runtimeDirectory), `${JSON.stringify(record, null, 2)}\n`);
  return activeRecordPath(runtimeDirectory);
}

export function readActiveRecord(runtimeDirectory) {
  return readRecord(activeRecordPath(runtimeDirectory));
}

export function clearActiveRecord(runtimeDirectory) {
  rmSync(activeRecordPath(runtimeDirectory), { force: true });
}
