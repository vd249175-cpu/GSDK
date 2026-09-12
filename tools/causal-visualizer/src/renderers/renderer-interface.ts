import type { CausalCommunity3D, CausalEdge3D, CausalNode3D } from '../types'

export type ParadigmType = 'swiss-2d'

export interface RendererCallbacks {
  onNodeSelect?: (nodeId: string | null) => void
}

/**
 * 2D 瑞士先锋主义因果看板视口渲染器接口
 */
export interface IVisualizerRenderer {
  /**
   * 挂载到指定的 DOM 容器
   */
  mount(container: HTMLElement): void

  /**
   * 同步/更新因果图拓扑
   */
  updateTopology(
    nodes: CausalNode3D[],
    edges: CausalEdge3D[],
    communities?: CausalCommunity3D[],
  ): void

  /**
   * 触发瞬时因果消息传递冲激 (ctx.send)
   */
  triggerInfoTransmission(
    fromNodeId: string,
    toNodeId: string,
    infoType: string,
    payloadSummary?: string,
  ): void

  /**
   * 触发节点受到冲击或状态变迁时的视觉反馈
   */
  triggerNodeImpact?(nodeId: string): void

  /**
   * 设置选中的节点高亮与上下游因果溯源
   */
  setSelectedNode(nodeId: string | null): void

  /**
   * 返回宏观全局全景视角
   */
  returnToOverview?(): void

  /**
   * 视口重置尺寸
   */
  resize(width: number, height: number): void

  /**
   * 销毁并释放所有资源与事件监听
   */
  dispose(): void
}
