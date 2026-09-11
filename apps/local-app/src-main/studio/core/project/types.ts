export const nodeTypeBySymbol = {
  '$': 'text',
  '@': 'image',
  '%': 'video',
  '~': 'audio',
  '&': 'style',
} as const

export type NodeSymbol = keyof typeof nodeTypeBySymbol
export type NodeType = (typeof nodeTypeBySymbol)[NodeSymbol]

export function usesTextPayload(type: NodeType) {
  return type === 'text' || type === 'style'
}

export interface NodeVersion {
  id: string
  label: string
  relativePath: string
  mimeType: string
  createdAt: string
  source: 'upload' | 'generated' | 'edit'
  current: boolean
}

export interface ProjectNode {
  id: string
  type: NodeType
  title: string
  description: string
  content?: string
  prompt?: string
  history?: NodeVersion[]
}

export type TreeRelation = 'structure' | 'content' | 'dependency' | 'root'

export interface ProjectTreeItem {
  key: string
  kind: 'structure' | 'node'
  title: string
  depth: number
  line: number
  relation: TreeRelation
  nodeId?: string
  nodeType?: NodeType
  symbol?: NodeSymbol
  children: ProjectTreeItem[]
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
    | 'retained-id-conflict'
  line: number
  message: string
  severity: 'warning' | 'error'
}

export interface ParsedProject {
  tree: ProjectTreeItem[]
  declarations: ProjectNode[]
  issues: ProjectIssue[]
}
