import { CausalScene3D } from '../causal-scene'
import type { CausalCommunity3D, CausalEdge3D, CausalNode3D } from '../types'
import type { IVisualizerRenderer, RendererCallbacks } from './renderer-interface'

/**
 * 3D 像素海岛生态呈现范式适配器
 * 封装 CausalScene3D，实现 IVisualizerRenderer 统一接口
 */
export class Archipelago3DRenderer implements IVisualizerRenderer {
  private scene: CausalScene3D | null = null
  private container: HTMLElement | null = null
  private callbacks: RendererCallbacks

  constructor(callbacks: RendererCallbacks = {}) {
    this.callbacks = callbacks
  }

  public mount(container: HTMLElement): void {
    this.container = container
    this.scene = new CausalScene3D(
      container,
      this.callbacks.onNodeSelect,
      this.callbacks.onItemInspect,
    )
  }

  public updateTopology(
    nodes: CausalNode3D[],
    edges: CausalEdge3D[],
    communities: CausalCommunity3D[],
  ): void {
    this.scene?.updateTopology(nodes, edges, communities)
  }

  public triggerInfoTransmission(
    fromNodeId: string,
    toNodeId: string,
    infoType: string,
    payloadSummary?: string,
  ): void {
    this.scene?.triggerInfoTransmission(fromNodeId, toNodeId, infoType, payloadSummary)
  }

  public triggerNodeImpact(nodeId: string): void {
    this.scene?.triggerNodeImpact(nodeId)
  }

  public setSelectedNode(nodeId: string | null): void {
    this.scene?.setSelectedNode(nodeId)
  }

  public focusNode(nodeId: string): void {
    this.scene?.focusIslandView(nodeId)
  }

  public returnToOverview(): void {
    this.scene?.returnToOverview()
  }

  public setAutoRotate(enabled: boolean): void {
    this.scene?.setAutoRotate(enabled)
  }

  public getNodeAssembly(nodeId: string): any {
    return this.scene?.getNodeAssembly(nodeId)
  }

  public resize(width: number, height: number): void {
    // CausalScene3D 内部通过 resize 事件自适应
  }

  public dispose(): void {
    if (this.scene) {
      this.scene.dispose()
      this.scene = null
    }
    this.container = null
  }
}
