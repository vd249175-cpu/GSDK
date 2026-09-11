import type { Info } from '@graphvideo/kernel';
import type { ProjectTreeItem, ProjectIssue } from '../domain/outliner/tree-editor';

export interface ParsedAstTreeInfo extends Info {
  readonly type: 'ParsedAstTreeInfo';
  readonly tree: ProjectTreeItem[];
  readonly issues: ProjectIssue[];
  readonly markdown: string;
}
