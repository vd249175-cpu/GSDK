import type { Info } from '@graphvideo/kernel';

export interface DocumentUpdatedInfo extends Info {
  readonly type: 'DocumentUpdatedInfo';
  readonly markdown: string;
  readonly revision: number;
  readonly persistenceMode?: 'full' | 'structure';
}

export interface ProjectTreeEditRequestedInfo extends Info {
  readonly type: 'ProjectTreeEditRequestedInfo';
  readonly operation: import('../domain/outliner/tree-editor').ProjectTreeEditOperation;
}

export interface ProjectTreeEditTaskInfo extends Info {
  readonly type: 'ProjectTreeEditTaskInfo';
  readonly operation: import('../domain/outliner/tree-editor').ProjectTreeEditOperation;
  readonly markdown: string;
  readonly baseRevision: number;
}

export interface ProjectDocumentReplacementInfo extends Info {
  readonly type: 'ProjectDocumentReplacementInfo';
  readonly markdown: string;
  readonly baseRevision: number;
  readonly persistenceMode?: 'full' | 'structure';
}
