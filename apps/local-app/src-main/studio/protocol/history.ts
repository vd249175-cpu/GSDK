import type { Info } from '@graphvideo/kernel';

/** Starts a fresh journal for a newly hydrated project or restored snapshot. */
export interface ProjectHistoryResetInfo extends Info {
  readonly type: 'ProjectHistoryResetInfo';
  readonly historyScopeId: string;
}

export interface UserSnapshotActionInfo extends Info {
  readonly type: 'UserSnapshotActionInfo';
  readonly action: {
    readonly type: 'CAPTURE' | 'UNDO' | 'REDO' | 'CLEAR_REDO';
  };
}

export interface SyncTreeInfo extends Info {
  readonly type: 'SyncTreeInfo';
  readonly tree: import('../domain/types').ProjectTreeItem[];
  readonly nodes: import('../domain/types').ProjectNode[];
  readonly markdown?: string;
  readonly persistenceMode?: 'full' | 'structure';
}
