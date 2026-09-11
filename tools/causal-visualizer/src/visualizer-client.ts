import type { CausalTelemetryEvent } from './types'

export interface TelemetryListener {
  (event: CausalTelemetryEvent): void
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
}

export class VisualizerClient {
  private listeners = new Set<TelemetryListener>()
  private unsubscribeIpc?: () => void
  private isElectron = typeof window !== 'undefined' && Boolean((window as any).graphvideoDesktop?.graphKernel)

  constructor() {
    this.connect()
  }

  private connect(): void {
    if (this.isElectron) {
      const kernel = (window as any).graphvideoDesktop.graphKernel
      this.unsubscribeIpc = kernel.subscribe('causal:telemetry', (event: CausalTelemetryEvent) => {
        this.emit(event)
      })
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
   * 从正在运行的微内核拉取实时投影快照
   */
  public async fetchLiveTopology(): Promise<TopologySnapshot> {
    if (this.isElectron) {
      const res = await (window as any).graphvideoDesktop.graphKernel.request('graph.topology.read')
      return res || { revision: 0, nodes: [] }
    }
    return { revision: 0, nodes: [] }
  }

  public dispose(): void {
    if (this.unsubscribeIpc) {
      this.unsubscribeIpc()
      this.unsubscribeIpc = undefined
    }
    this.listeners.clear()
  }
}

export const visualizerClient = new VisualizerClient()
