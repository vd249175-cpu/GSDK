import * as THREE from 'three'
import type { CausalCommunity3D, CausalEdge3D, CausalNode3D, InspectItemData } from './types'
import { generateIslandAssembly, type IslandVisualAssembly } from './island-generator'
import { CameraController } from './scene/camera-controller'
import { OceanEnvironment } from './scene/ocean-environment'
import { NauticalRoutesManager } from './scene/nautical-routes'
import { SceneLabelsManager, type CommunityVisual } from './scene/scene-labels'

interface NodeVisual {
  group: THREE.Group
  assembly: IslandVisualAssembly
  sprite: THREE.Sprite
  node: CausalNode3D
  glowIntensity: number
}

export class CausalScene3D {
  private container: HTMLElement
  private scene: THREE.Scene
  private renderer: THREE.WebGLRenderer
  private clock = new THREE.Clock()

  private cameraController: CameraController
  private oceanEnv: OceanEnvironment
  private routesManager: NauticalRoutesManager

  private nodeVisuals = new Map<string, NodeVisual>()
  private communityVisuals = new Map<string, CommunityVisual>()

  // 选中态与因果链路溯源
  private selectedNodeId: string | null = null
  private upstreamNodeIds = new Set<string>()
  private downstreamNodeIds = new Set<string>()
  private upstreamEdgeIds = new Set<string>()
  private downstreamEdgeIds = new Set<string>()

  private raycaster = new THREE.Raycaster()
  private mouse = new THREE.Vector2()
  private pointerDownPos = { x: 0, y: 0 }

  private onNodeSelectedCallback?: (nodeId: string | null) => void
  private onItemInspectedCallback?: (item: InspectItemData | null) => void

  private animFrameId?: number
  private isDisposed = false

  constructor(
    container: HTMLElement,
    onNodeSelected?: (nodeId: string | null) => void,
    onItemInspected?: (item: InspectItemData | null) => void,
  ) {
    this.container = container
    this.onNodeSelectedCallback = onNodeSelected
    this.onItemInspectedCallback = onItemInspected

    // 1. Three.js 场景初始化
    this.scene = new THREE.Scene()

    // 2. 渲染器初始化
    const width = container.clientWidth || window.innerWidth
    const height = container.clientHeight || window.innerHeight
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setSize(width, height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.35
    container.appendChild(this.renderer.domElement)

    // 3. 摄像机与全景/微观平滑切角控制器
    this.cameraController = new CameraController(
      this.renderer.domElement,
      width,
      height,
      () => {
        this.setSelectedNode(null)
        this.onNodeSelectedCallback?.(null)
        this.onItemInspectedCallback?.(null)
      },
    )

    // 4. 海天大气与低多边形波光海面
    this.oceanEnv = new OceanEnvironment(this.scene)

    // 5. 航海图航线、帆船与水波扩散涟漪管理器
    this.routesManager = new NauticalRoutesManager(this.scene, (targetNodeId) => {
      this.triggerNodeImpact(targetNodeId)
    })

    // 6. 事件绑定
    this.onResize = this.onResize.bind(this)
    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)
    window.addEventListener('resize', this.onResize)
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp)

    // 7. 渲染帧循环启动
    this.animate = this.animate.bind(this)
    this.animate()
  }

  public setAutoRotate(enabled: boolean): void {
    this.cameraController.setAutoRotate(enabled)
  }

  public returnToOverview(): void {
    this.setSelectedNode(null)
    this.cameraController.returnToOverview()
  }

  public resetCamera(): void {
    this.returnToOverview()
  }

  public focusIslandView(nodeId: string): void {
    const visual = this.nodeVisuals.get(nodeId)
    if (!visual) return

    this.setSelectedNode(nodeId)
    this.cameraController.focusIsland(visual.group.position)

    if (visual.assembly.triggerLighthouseSweep) {
      visual.assembly.triggerLighthouseSweep()
    }
  }

  public focusNode(nodeId: string): void {
    this.focusIslandView(nodeId)
  }

  public getNodeAssembly(nodeId: string): IslandVisualAssembly | undefined {
    return this.nodeVisuals.get(nodeId)?.assembly
  }

  /**
   * 拓扑结构增量同步更新
   */
  public updateTopology(
    nodes: CausalNode3D[],
    edges: CausalEdge3D[],
    communities: CausalCommunity3D[],
  ): void {
    const currentNodeIds = new Set(nodes.map((n) => n.id))

    // 清理卸载的海岛
    for (const [id, visual] of this.nodeVisuals.entries()) {
      if (!currentNodeIds.has(id)) {
        this.scene.remove(visual.group)
        this.disposeObject(visual.group)
        this.nodeVisuals.delete(id)
      }
    }

    // 增量同步海岛节点
    for (const node of nodes) {
      const existing = this.nodeVisuals.get(node.id)
      if (existing) {
        existing.node = node
        existing.group.position.set(...node.position)
        existing.assembly.node = node
        SceneLabelsManager.updateNodeSprite(
          existing.sprite,
          existing.node,
          this.selectedNodeId === node.id,
          this.upstreamNodeIds.has(node.id),
          this.downstreamNodeIds.has(node.id),
        )
      } else {
        const visual = this.createNodeVisual(node)
        this.nodeVisuals.set(node.id, visual)
        this.scene.add(visual.group)
      }
    }

    // 同步群落光环
    const currentCommIds = new Set(communities.map((c) => c.id))
    for (const [id, visual] of this.communityVisuals.entries()) {
      if (!currentCommIds.has(id)) {
        this.scene.remove(visual.group)
        this.disposeObject(visual.group)
        this.communityVisuals.delete(id)
      }
    }
    for (const comm of communities) {
      if (!this.communityVisuals.has(comm.id)) {
        const visual = SceneLabelsManager.createCommunityVisual(comm)
        this.communityVisuals.set(comm.id, visual)
        this.scene.add(visual.group)
      }
    }

    // 同步航海航线
    this.routesManager.updateEdges(edges, (id) => this.nodeVisuals.get(id)?.group.position)

    // 刷新因果高亮状态
    if (this.selectedNodeId) {
      this.setSelectedNode(this.selectedNodeId)
    }
  }

  public setSelectedNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId
    if (nodeId) {
      this.computeCausalPaths(nodeId)
    } else {
      this.upstreamNodeIds.clear()
      this.downstreamNodeIds.clear()
      this.upstreamEdgeIds.clear()
      this.downstreamEdgeIds.clear()
    }

    for (const [id, visual] of this.nodeVisuals.entries()) {
      const isTarget = id === nodeId
      const isUpstream = this.upstreamNodeIds.has(id)
      const isDownstream = this.downstreamNodeIds.has(id)
      const isRelated = isTarget || isUpstream || isDownstream
      const isDimmed = Boolean(nodeId && !isRelated)

      if (isTarget) {
        visual.group.scale.set(1.2, 1.2, 1.2)
      } else if (isUpstream || isDownstream) {
        visual.group.scale.set(1.08, 1.08, 1.08)
      } else if (isDimmed) {
        visual.group.scale.set(0.9, 0.9, 0.9)
      } else {
        visual.group.scale.set(1.0, 1.0, 1.0)
      }

      SceneLabelsManager.updateNodeSprite(
        visual.sprite,
        visual.node,
        isTarget,
        isUpstream,
        isDownstream,
      )
    }

    this.routesManager.highlightRoutes(this.upstreamEdgeIds, this.downstreamEdgeIds, nodeId)
  }

  public triggerInfoTransmission(
    fromNodeId: string,
    toNodeId: string,
    infoType: string,
    payloadSummary?: string,
  ): void {
    const fromNode = this.nodeVisuals.get(fromNodeId)
    const toNode = this.nodeVisuals.get(toNodeId)

    if (fromNode?.assembly.triggerLighthouseSweep) {
      fromNode.assembly.triggerLighthouseSweep()
    }
    if (toNode?.assembly.triggerLighthouseSweep) {
      toNode.assembly.triggerLighthouseSweep()
    }

    this.routesManager.triggerTransmission(fromNodeId, toNodeId, infoType, payloadSummary)

    if (fromNode) {
      fromNode.glowIntensity = 0.8
      fromNode.assembly.triggerJump()
    }
  }

  public triggerNodeImpact(nodeId: string): void {
    const visual = this.nodeVisuals.get(nodeId)
    if (!visual) return

    visual.glowIntensity = 1.0
    visual.assembly.triggerJump()
    if (visual.assembly.triggerLighthouseSweep) {
      visual.assembly.triggerLighthouseSweep()
    }

    this.routesManager.triggerShockwave(visual.group.position, visual.node.color, nodeId)
  }

  private computeCausalPaths(targetId: string): void {
    this.upstreamNodeIds.clear()
    this.downstreamNodeIds.clear()
    this.upstreamEdgeIds.clear()
    this.downstreamEdgeIds.clear()

    const inEdges = new Map<string, Array<{ from: string; edgeId: string }>>()
    const outEdges = new Map<string, Array<{ to: string; edgeId: string }>>()

    for (const [id, visual] of this.routesManager.getEdgeVisuals().entries()) {
      if (visual.edge.isVerticalStalk) continue
      const { from, to } = visual.edge
      if (!inEdges.has(to)) inEdges.set(to, [])
      inEdges.get(to)!.push({ from, edgeId: id })
      if (!outEdges.has(from)) outEdges.set(from, [])
      outEdges.get(from)!.push({ to, edgeId: id })
    }

    const upQueue = [targetId]
    const upVisited = new Set<string>([targetId])
    while (upQueue.length > 0) {
      const curr = upQueue.shift()!
      const predecessors = inEdges.get(curr) || []
      for (const { from, edgeId } of predecessors) {
        this.upstreamEdgeIds.add(edgeId)
        if (!upVisited.has(from)) {
          upVisited.add(from)
          this.upstreamNodeIds.add(from)
          upQueue.push(from)
        }
      }
    }

    const downQueue = [targetId]
    const downVisited = new Set<string>([targetId])
    while (downQueue.length > 0) {
      const curr = downQueue.shift()!
      const successors = outEdges.get(curr) || []
      for (const { to, edgeId } of successors) {
        this.downstreamEdgeIds.add(edgeId)
        if (!downVisited.has(to)) {
          downVisited.add(to)
          this.downstreamNodeIds.add(to)
          downQueue.push(to)
        }
      }
    }
  }

  private onPointerDown(event: PointerEvent): void {
    this.pointerDownPos = { x: event.clientX, y: event.clientY }
  }

  private onPointerUp(event: PointerEvent): void {
    const dist = Math.hypot(event.clientX - this.pointerDownPos.x, event.clientY - this.pointerDownPos.y)
    if (dist > 6) return // 忽略镜头拖拽旋转

    const rect = this.renderer.domElement.getBoundingClientRect()
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.mouse, this.cameraController.camera)
    const meshes: THREE.Object3D[] = []
    for (const visual of this.nodeVisuals.values()) {
      visual.assembly.rootGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) meshes.push(child)
      })
    }

    const intersects = this.raycaster.intersectObjects(meshes, false)
    if (intersects.length > 0) {
      let curr: THREE.Object3D | null = intersects[0].object
      let hitInspectData: InspectItemData | undefined
      let hitNodeId: string | undefined

      while (curr) {
        if (!hitInspectData && curr.userData?.inspectData) {
          hitInspectData = curr.userData.inspectData as InspectItemData
        }
        if (!hitNodeId && curr.userData?.nodeId) {
          hitNodeId = curr.userData.nodeId as string
        }
        curr = curr.parent
      }

      if (hitInspectData) {
        this.focusIslandView(hitInspectData.nodeId)
        this.triggerItemBounce(intersects[0].object)
        this.onNodeSelectedCallback?.(hitInspectData.nodeId)
        this.onItemInspectedCallback?.(hitInspectData)
        return
      }

      if (hitNodeId) {
        this.focusIslandView(hitNodeId)
        this.onNodeSelectedCallback?.(hitNodeId)
        this.onItemInspectedCallback?.(null)
        return
      }
    }

    // 点击空海面背景：平滑返回高空俯瞰全景，清空选中态
    this.returnToOverview()
    this.onNodeSelectedCallback?.(null)
    this.onItemInspectedCallback?.(null)
  }

  private triggerItemBounce(mesh: THREE.Object3D): void {
    let target = mesh
    while (target.parent && target.parent !== this.scene && target.userData?.inspectData) {
      target = target.parent
    }
    const startY = target.position.y
    let step = 0
    const interval = setInterval(() => {
      step += 0.25
      target.position.y = startY + Math.sin(step) * 0.45
      if (step >= Math.PI) {
        target.position.y = startY
        clearInterval(interval)
      }
    }, 16)
  }

  private createNodeVisual(node: CausalNode3D): NodeVisual {
    const assembly = generateIslandAssembly(node)
    const group = new THREE.Group()
    group.position.set(...node.position)
    group.add(assembly.rootGroup)

    const sprite = SceneLabelsManager.createNodeSprite(node)
    sprite.position.set(0, 3.6, 0)
    group.add(sprite)

    group.userData = { nodeId: node.id }
    assembly.rootGroup.userData = { nodeId: node.id }
    assembly.islandMesh.userData = { nodeId: node.id }

    return { group, assembly, sprite, node, glowIntensity: 0 }
  }

  private onResize(): void {
    if (!this.container || this.isDisposed) return
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    this.cameraController.onResize(width, height)
    this.renderer.setSize(width, height)
  }

  private animate(): void {
    if (this.isDisposed) return
    this.animFrameId = requestAnimationFrame(this.animate)

    // 注意：优先读取 getDelta()，再读取 elapsedTime 属性，避免 Three.js 时钟重置归零问题
    const delta = Math.min(0.08, this.clock.getDelta())
    const time = this.clock.elapsedTime

    // 1. 摄像机控制器更新（平滑滑行插值）
    this.cameraController.update(delta)

    // 2. 海天大气与海面低多边形波浪起伏更新
    this.oceanEnv.update(time)

    // 3. 岛屿周期性生态律动
    for (const visual of this.nodeVisuals.values()) {
      visual.assembly.updateEcosystem(time, visual.node.status === 'RUNNING')

      if (visual.glowIntensity > 0) {
        visual.glowIntensity -= 0.02
        if (visual.glowIntensity < 0) visual.glowIntensity = 0
      }
    }

    // 4. 航运航线、帆船与水波扩散更新
    this.routesManager.update(time)

    // 5. WebGL 渲染
    this.renderer.render(this.scene, this.cameraController.camera)
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose())
          } else {
            mesh.material.dispose()
          }
        }
      }
    })
  }

  public dispose(): void {
    this.isDisposed = true
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId)

    window.removeEventListener('resize', this.onResize)
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp)

    this.oceanEnv.dispose()
    this.routesManager.dispose()
    this.cameraController.dispose()

    for (const visual of this.nodeVisuals.values()) {
      this.scene.remove(visual.group)
      this.disposeObject(visual.group)
    }
    this.nodeVisuals.clear()

    for (const visual of this.communityVisuals.values()) {
      this.scene.remove(visual.group)
      this.disposeObject(visual.group)
    }
    this.communityVisuals.clear()

    this.renderer.dispose()
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
  }
}
