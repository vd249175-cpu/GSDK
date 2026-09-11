/**
 * GraphVideo 领域强类型定义 (Domain Data Models)
 */

export const nodeTypeBySymbol = {
  $: 'text',
  '@': 'image',
  '%': 'video',
  '~': 'audio',
  '&': 'style',
} as const;

export type NodeSymbol = keyof typeof nodeTypeBySymbol;
export type NodeType = (typeof nodeTypeBySymbol)[NodeSymbol];

export function usesTextPayload(type: NodeType) {
  return type === 'text' || type === 'style';
}

export interface NodeVersion {
  id: string;
  label: string;
  relativePath: string;
  mimeType: string;
  createdAt: string;
  source: 'upload' | 'generated' | 'edit';
  current: boolean;
}

export interface ProjectNode {
  id: string;
  type: NodeType;
  title: string;
  description: string;
  content?: string;
  prompt?: string;
  history?: NodeVersion[];
}

export type TreeRelation = 'structure' | 'content' | 'dependency' | 'root';

export interface ProjectTreeItem {
  key: string;
  kind: 'structure' | 'node';
  title: string;
  depth: number;
  line: number;
  relation: TreeRelation;
  nodeId?: string;
  nodeType?: NodeType;
  symbol?: NodeSymbol;
  children: ProjectTreeItem[];
}

export interface ProjectIssue {
  code:
    | 'missing-map'
    | 'type-mismatch'
    | 'duplicate-id'
    | 'missing-structure'
    | 'unclosed-structure'
    | 'duplicate-structure'
    | 'invalid-indent'
    | 'retained-id-conflict';
  line: number;
  message: string;
  severity: 'warning' | 'error';
}

export interface ParsedProject {
  tree: ProjectTreeItem[];
  declarations: ProjectNode[];
  issues: ProjectIssue[];
}

export interface AstNode {
  id: string;
  type: NodeType;
  title: string;
  symbol: string;
  depth: number;
  line: number;
  relation: 'root' | 'structure' | 'content' | 'dependency';
  parentId?: string;
  children: AstNode[];
  content?: string;
  prompt?: string;
}

export interface ParseIssue {
  code: string;
  line: number;
  severity: 'error' | 'warning';
  message: string;
}

export type ProjectParseResult = ParsedProject;

export interface GenerationModelManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  mediaType: 'image' | 'video' | 'audio';
  provider: string;
  apiModel: string;
  parameters: Record<string, any>;
  defaults: Record<string, any>;
}

export interface ComfyUiWorkflowConfig {
  schemaVersion?: number;
  id?: string;
  name?: string;
  description?: string;
  mediaType?: 'image' | 'video' | 'audio' | string;
  provider?: string;
  baseUrl?: string;
  graph?: Record<string, { class_type: string; inputs: Record<string, any> }>;
  bindings?: Record<string, any>;
  defaults?: Record<string, any>;
}

export interface GeneratedArtifact {
  kind: 'image' | 'video' | 'audio';
  url: string;
  filename: string;
  base64?: string;
  timestamp: number;
}

export interface VideoExportTask {
  projectId: string;
  outputFilename: string;
  clipNodeIds: string[];
  fps?: number;
  resolution?: string;
}

export interface TreeOperation {
  type: 'RENAME' | 'MOVE' | 'REMOVE' | 'INSERT';
  nodeId: string;
  payload?: any;
}

export interface PromptReferenceItem {
  id: string;
  type: NodeType;
  title: string;
  ordinal: number;
  content?: string;
}

export type { AudioTaskPayload } from './audio/types';
