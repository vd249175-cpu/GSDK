import type { CausalCommunity3D, CausalEdge3D, CausalNode3D, InspectItemData } from '../types'

export type ParadigmType = 'island-3d' | 'swiss-2d'

export interface RendererCallbacks {
  onNodeSelect?: (nodeId: string | null) => void
  onItemInspect?: (item: InspectItemData | null) => void
}

/**
 * 统一步进式因果呈现范式接口
 * 无论是 3D 像素海岛还是 2D 瑞士先锋主义看板，均实现此接口
 */
export interface IVisualizerRenderer {
  /**
   * 挂载到指定的 DOM 容器
   */
  mount(container: HTMLElement): void

  /**
   * 同步/更新因果图拓扑与群落结构
   */
  updateTopology(
    nodes: CausalNode3D[],
    edges: CausalEdge3D[],
    communities: CausalCommunity3D[],
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
   * 聚焦某个节点微观视角
   */
  focusNode?(nodeId: string): void

  /**
   * 返回宏观全局全景视角
   */
  returnToOverview?(): void

  /**
   * 开启/关闭自动旋转（若视口支持）
   */
  setAutoRotate?(enabled: boolean): void

  /**
   * 获取指定节点的生态检查装配项（若视口支持）
   */
  getNodeAssembly?(nodeId: string): any

  /**
   * 视口重置尺寸
   */
  resize(width: number, height: number): void

  /**
   * 销毁并释放所有资源与事件监听
   */
  dispose(): void
}
