export type CausalNodeRole = 'domain' | 'observation' | 'execution'

export type InspectItemCategory =
  | 'state_field'
  | 'change_villager'
  | 'system_landmark'
  | 'island_flora'

export interface InspectItemData {
  id: string
  nodeId: string
  nodeName: string
  itemType:
    | 'villager'
    | 'crystal'
    | 'windmill'
    | 'crop'
    | 'campfire'
    | 'sheep'
    | 'rabbit'
    | 'mushroom'
    | 'flower'
    | 'rock'
    | 'house'
    | 'lighthouse'
    | 'fishingPier'
    | 'tree'
  itemName: string
  itemIcon: string
  category: InspectItemCategory
  stateKey?: string
  stateValue?: unknown
  valueType?: string
  description: string
}

export interface CausalNode3D {
  id: string
  name: string
  color: string
  position: [number, number, number]
  generation: number | null
  version: number
  status: 'IDLE' | 'RUNNING' | 'DROPPED'
  state: Record<string, unknown>
  role: CausalNodeRole
  parentDomainNodeId?: string
  tier?: number
  communityId?: string
  communityName?: string
  inDegree?: number
  outDegree?: number
  isHub?: boolean
}

export interface CausalCommunity3D {
  id: string
  name: string
  color: string
  center: [number, number, number]
  radius: number
  nodeIds: string[]
  hubNodeId: string
}

export interface CausalEdge3D {
  id: string
  from: string
  to: string
  color: string
  active: boolean
  isVerticalStalk?: boolean
  lastSentTime?: number
  lastInfoType?: string
}

export interface PhotonPulse {
  id: string
  edgeId: string
  from: [number, number, number]
  to: [number, number, number]
  progress: number
  speed: number
  color: string
  infoType: string
  payloadSummary?: string
}

export interface Shockwave {
  id: string
  nodeId: string
  position: [number, number, number]
  radius: number
  maxRadius: number
  opacity: number
  color: string
}

export type CausalTelemetryEvent =
  | {
      type: 'root_injected'
      targetNodeId: string
      info: { type: string; [key: string]: unknown }
      submissionId: string
      timestamp: number
    }
  | {
      type: 'info_sent'
      fromNodeId: string
      toNodeId: string
      info: { type: string; [key: string]: unknown }
      submissionId?: string
      changeId: number
      status: 'enqueued' | 'dropped'
      timestamp: number
    }
  | {
      type: 'change_start'
      nodeId: string
      info: { type: string; [key: string]: unknown }
      submissionId?: string
      changeId: number
      timestamp: number
    }
  | {
      type: 'change_end'
      nodeId: string
      submissionId?: string
      changeId: number
      durationMs: number
      timestamp: number
    }
  | {
      type: 'state_mutated'
      nodeId: string
      version: number
      state: Record<string, unknown>
      timestamp: number
    }
  | {
      type: 'node_admitted'
      nodeId: string
      generation: number
      timestamp: number
    }
  | {
      type: 'node_evicted'
      nodeId: string
      timestamp: number
    }
