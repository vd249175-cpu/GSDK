export interface CausalNode3D {
  id: string
  name: string
  color: string
  position: [number, number, number]
  generation: number | null
  version: number
  status: 'IDLE' | 'RUNNING' | 'DROPPED'
  state: Record<string, unknown>
  tier?: number
}

export interface CausalEdge3D {
  id: string
  from: string
  to: string
  color: string
  active: boolean
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
