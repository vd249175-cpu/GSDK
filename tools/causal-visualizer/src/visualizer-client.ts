import type { CausalTelemetryEvent } from './types'

export interface TelemetryListener {
  (event: CausalTelemetryEvent): void
}

export interface ConnectionListener {
  (connected: boolean): void
}

export interface TopologySnapshot {
  revision: number
  nodes: Array<{
    nodeId: string
    generation: number | null
    version: number
    status: string
    state: Record<string, unknown>
  }>
  routes?: Array<{
    from: string
    to: string
    infoType?: string
  }>
  recentEvents?: CausalTelemetryEvent[]
}

const DEFAULT_SERVER_URL = 'http://127.0.0.1:51888'

export class VisualizerClient {
  private listeners = new Set<TelemetryListener>()
  private connListeners = new Set<ConnectionListener>()
  private unsubscribeIpc?: () => void
  private eventSource?: EventSource
  private isElectron = typeof window !== 'undefined' && Boolean((window as any).graphvideoDesktop?.graphKernel)
  private isConnected = false
  private reconnectTimer?: ReturnType<typeof setTimeout>

  constructor() {
    this.connect()
  }

  public get connected(): boolean {
    return this.isConnected
  }

  public onConnectionChange(listener: ConnectionListener): () => void {
    this.connListeners.add(listener)
    listener(this.isConnected)
    return () => this.connListeners.delete(listener)
  }

  private notifyConnection(status: boolean): void {
    if (this.isConnected !== status) {
      this.isConnected = status
      for (const listener of this.connListeners) {
        try {
          listener(status)
        } catch (err) {
          console.error('[VisualizerClient] connection listener error:', err)
        }
      }
    }
  }

  private connect(): void {
    if (this.isElectron) {
      const kernel = (window as any).graphvideoDesktop.graphKernel
      this.unsubscribeIpc = kernel.subscribe('causal:telemetry', (event: CausalTelemetryEvent) => {
        this.emit(event)
      })
      this.notifyConnection(true)
      return
    }

    this.connectSSE()
  }

  private connectSSE(): void {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return

    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = undefined
    }

    try {
      const sse = new EventSource(`${DEFAULT_SERVER_URL}/api/events`)
      this.eventSource = sse

      sse.onopen = () => {
        this.notifyConnection(true)
      }

      sse.onmessage = (msg) => {
        try {
          const event: CausalTelemetryEvent = JSON.parse(msg.data)
          this.emit(event)
        } catch (err) {
          console.warn('[VisualizerClient] Failed to parse SSE event:', err)
        }
      }

      sse.onerror = () => {
        this.notifyConnection(false)
        // 5秒后尝试重建连接
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined
            this.connectSSE()
          }, 3000)
        }
      }
    } catch {
      this.notifyConnection(false)
    }
  }

  public subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public emit(event: CausalTelemetryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[VisualizerClient] telemetry listener error:', err)
      }
    }
  }

  /**
   * 从正在运行的微内核拉取实时拓扑与状态快照
   */
  public async fetchLiveTopology(): Promise<TopologySnapshot> {
    if (this.isElectron) {
      const res = await (window as any).graphvideoDesktop.graphKernel.request('graph.topology.read')
      return res || { revision: 0, nodes: [] }
    }

    try {
      const res = await fetch(`${DEFAULT_SERVER_URL}/api/topology`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: TopologySnapshot = await res.json()
      this.notifyConnection(true)
      return data
    } catch {
      this.notifyConnection(false)
      return { revision: 0, nodes: [] }
    }
  }

  public dispose(): void {
    if (this.unsubscribeIpc) {
      this.unsubscribeIpc()
      this.unsubscribeIpc = undefined
    }
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = undefined
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    this.listeners.clear()
    this.connListeners.clear()
  }
}

export const visualizerClient = new VisualizerClient()

