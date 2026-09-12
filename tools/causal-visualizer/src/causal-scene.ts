import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CausalCommunity3D, CausalEdge3D, CausalNode3D, PhotonPulse, Shockwave } from './types'
import { generateIslandAssembly, type IslandVisualAssembly } from './island-generator'
import { createVoxelBoat } from './voxel-models'

interface NodeVisual {
  group: THREE.Group
  assembly: IslandVisualAssembly
  sprite: THREE.Sprite
  node: CausalNode3D
  glowIntensity: number
}

interface EdgeVisual {
  lineMesh: THREE.Mesh
  arrowMesh: THREE.Mesh
  curve: THREE.CubicBezierCurve3
  edge: CausalEdge3D
  glowIntensity: number
}

interface CommunityVisual {
  group: THREE.Group
  ring: THREE.Mesh
  sprite: THREE.Sprite
  community: CausalCommunity3D
}

interface BoatVisual {
  pulse: PhotonPulse
  mesh: THREE.Group
  curve: THREE.CubicBezierCurve3
  targetNodeId: string
}

interface ShockwaveVisual {
  wave: Shockwave
  mesh: THREE.Mesh
}

export class CausalScene3D {
  private container: HTMLElement
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private clock = new THREE.Clock()

  private static readonly MAX_BOATS = 30
  private static readonly MAX_SHOCKWAVES = 12

  private sharedShockwaveGeo = new THREE.RingGeometry(1.2, 1.8, 32)
  private sharedArrowGeo = new THREE.ConeGeometry(0.55, 1.4, 12)

  private nodeVisuals = new Map<string, NodeVisual>()
  private edgeVisuals = new Map<string, EdgeVisual>()
  private communityVisuals = new Map<string, CommunityVisual>()
  private boats: BoatVisual[] = []
  private shockwaves: ShockwaveVisual[] = []
  private oceanMesh?: THREE.Mesh
  private oceanGeometry?: THREE.PlaneGeometry
  private skyMesh?: THREE.Mesh
  private clouds: THREE.Group[] = []

  // 选中态与因果链路溯源集合
  private selectedNodeId: string | null = null
  private upstreamNodeIds = new Set<string>()
  private downstreamNodeIds = new Set<string>()
  private upstreamEdgeIds = new Set<string>()
  private downstreamEdgeIds = new Set<string>()

  private raycaster = new THREE.Raycaster()
  private mouse = new THREE.Vector2()
  private onNodeSelectedCallback?: (nodeId: string | null) => void

  private animFrameId?: number
  private isDisposed = false

  constructor(container: HTMLElement, onNodeSelected?: (nodeId: string | null) => void) {
    this.container = container
    this.onNodeSelectedCallback = onNodeSelected

    // 1. 场景与明朗海天大气环境 (Vibrant Sunny Ocean & Sky Atmosphere)
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#7dd3fc') // 晨曦蔚蓝天际
    this.scene.fog = new THREE.Fog('#7dd3fc', 60, 420) // 远海无缝消隐于海平线晨雾

    // 2. 摄像机
    const width = container.clientWidth || window.innerWidth
    const height = container.clientHeight || window.innerHeight
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 650)
    this.camera.position.set(0, 32, 68)

    // 3. 渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setSize(width, height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.35
    container.appendChild(this.renderer.domElement)

    // 4. 轨道控制器
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.maxDistance = 260
    this.controls.minDistance = 8

    // 5. 明媚海岛光照体系（半球天光 + 阳光直射 + 海面碧蓝漫反射）
    const hemiLight = new THREE.HemisphereLight(0xbae6fd, 0x0284c7, 1.8)
    this.scene.add(hemiLight)

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 2.8)
    sunLight.position.set(60, 95, 45)
    this.scene.add(sunLight)

    const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.2)
    fillLight.position.set(-45, 25, -45)
    this.scene.add(fillLight)

    // 6. 天空穹顶 (Sky Dome Gradient)
    this.initSkyDome()

    // 7. 无垠低多边形波光海洋水面 (Endless Faceted Low-poly Ocean)
    this.initOcean()

    // 8. 低空随风浮云 (Drifting Sea Clouds)
    this.initClouds()

    // 9. 事件绑定
    this.onResize = this.onResize.bind(this)
    this.onPointerDown = this.onPointerDown.bind(this)
    window.addEventListener('resize', this.onResize)
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)

    // 10. 启动渲染循环
    this.animate = this.animate.bind(this)
    this.animate()
  }

  private initSkyDome(): void {
    const skyGeo = new THREE.SphereGeometry(480, 32, 16)
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createLinearGradient(0, 0, 0, 512)
    grad.addColorStop(0.0, '#0284c7') // 天顶深蓝
    grad.addColorStop(0.4, '#38bdf8') // 亮蓝海空
    grad.addColorStop(0.8, '#7dd3fc') // 海平线柔青
    grad.addColorStop(1.0, '#bae6fd') // 暖色海雾
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 2, 512)

    const texture = new THREE.CanvasTexture(canvas)
    const skyMat = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      depthWrite: false,
    })
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat)
    this.scene.add(this.skyMesh)
  }

  private initOcean(): void {
    // 宽广无垠的低多边形海面
    const size = 1200
    const segments = 64
    this.oceanGeometry = new THREE.PlaneGeometry(size, size, segments, segments)
    this.oceanGeometry.rotateX(-Math.PI / 2)

    const oceanMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7, // 明澈蔚蓝热带海面
      roughness: 0.15,
      metalness: 0.12,
      flatShading: true,
      transparent: true,
      opacity: 0.94,
    })
    this.oceanMesh = new THREE.Mesh(this.oceanGeometry, oceanMat)
    this.oceanMesh.position.y = 0.0
    this.scene.add(this.oceanMesh)
  }

  private initClouds(): void {
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      flatShading: true,
    })

    const cloudCount = 12
    for (let c = 0; c < cloudCount; c++) {
      const cloud = new THREE.Group()
      const boxCount = 3 + (c % 3)
      for (let b = 0; b < boxCount; b++) {
        const bw = 5 + ((c * 3 + b) % 4)
        const bh = 2.2 + (b % 2) * 0.6
        const bd = 4 + ((c + b) % 3)
        const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), cloudMat)
        box.position.set((b - boxCount / 2) * 3.4, (b % 2) * 0.8, ((b * 2) % 3) - 1.5)
        cloud.add(box)
      }

      const angle = (c / cloudCount) * Math.PI * 2 + (c % 2) * 0.3
      const dist = 70 + (c % 4) * 32
      cloud.position.set(Math.cos(angle) * dist, 42 + (c % 3) * 6, Math.sin(angle) * dist)
      cloud.scale.setScalar(1.2 + (c % 3) * 0.3)
      this.scene.add(cloud)
      this.clouds.push(cloud)
    }
  }

  public setAutoRotate(enabled: boolean): void {
    this.controls.autoRotate = enabled
    this.controls.autoRotateSpeed = 0.8
  }

  public resetCamera(): void {
    this.controls.target.set(0, 0, 0)
    this.camera.position.set(0, 28, 56)
    this.controls.update()
  }

  public focusNode(nodeId: string): void {
    const visual = this.nodeVisuals.get(nodeId)
    if (!visual) return
    const pos = visual.group.position
    this.controls.target.copy(pos)
    this.camera.position.set(pos.x, pos.y + 6, pos.z + 16)
    this.controls.update()
  }

  private createCubicCurve(fromPos: THREE.Vector3, toPos: THREE.Vector3): THREE.CubicBezierCurve3 {
    const midPoint = new THREE.Vector3().addVectors(fromPos, toPos).multiplyScalar(0.5)
    // 航海航线贴近海平面 (y = 0.2 ~ 0.5) 保持开阔视野
    return new THREE.CubicBezierCurve3(
      new THREE.Vector3(fromPos.x, 0.22, fromPos.z),
      new THREE.Vector3(fromPos.x * 0.7 + midPoint.x * 0.3, 0.28, fromPos.z * 0.7 + midPoint.z * 0.3),
      new THREE.Vector3(toPos.x * 0.7 + midPoint.x * 0.3, 0.28, toPos.z * 0.7 + midPoint.z * 0.3),
      new THREE.Vector3(toPos.x, 0.22, toPos.z),
    )
  }

  private updateArrowTransform(arrow: THREE.Mesh, curve: THREE.CubicBezierCurve3): void {
    const t = 0.82
    const pt = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t).normalize()

    arrow.position.set(pt.x, 0.25, pt.z)
    const defaultDir = new THREE.Vector3(0, 1, 0)
    const quat = new THREE.Quaternion().setFromUnitVectors(defaultDir, tangent)
    arrow.quaternion.copy(quat)
  }

  /**
   * 图无关拓扑更新：接收任意节点、边与社区聚类并更新 3D 像素海岛群岛场景
   */
  public updateTopology(
    nodes: CausalNode3D[],
    edges: CausalEdge3D[],
    communities: CausalCommunity3D[] = [],
  ): void {
    const currentNodes = new Set(nodes.map((n) => n.id))
    const currentEdges = new Set(edges.map((e) => e.id))
    const currentComms = new Set(communities.map((c) => c.id))

    // 1. 移除已消失的社区基座
    for (const [id, visual] of this.communityVisuals.entries()) {
      if (!currentComms.has(id)) {
        this.scene.remove(visual.group)
        this.disposeObject(visual.group)
        this.communityVisuals.delete(id)
      }
    }

    // 2. 更新或创建社区海域光环
    for (const comm of communities) {
      if (comm.nodeIds.length <= 1) continue // 单岛屿不画外围大环
      const existing = this.communityVisuals.get(comm.id)
      if (existing) {
        existing.community = comm
        existing.group.position.set(comm.center[0], 0.04, comm.center[2])
      } else {
        const visual = this.createCommunityVisual(comm)
        this.communityVisuals.set(comm.id, visual)
        this.scene.add(visual.group)
      }
    }

    // 3. 移除已消失的节点海岛
    for (const [id, visual] of this.nodeVisuals.entries()) {
      if (!currentNodes.has(id)) {
        this.scene.remove(visual.group)
        this.disposeObject(visual.group)
        this.nodeVisuals.delete(id)
      }
    }

    // 4. 移除已消失的边航线
    for (const [id, visual] of this.edgeVisuals.entries()) {
      if (!currentEdges.has(id)) {
        this.scene.remove(visual.lineMesh)
        this.scene.remove(visual.arrowMesh)
        visual.lineMesh.geometry.dispose()
        ;(visual.lineMesh.material as THREE.Material).dispose()
        ;(visual.arrowMesh.material as THREE.Material).dispose()
        this.edgeVisuals.delete(id)
      }
    }

    // 5. 更新或创建海岛实体
    for (const node of nodes) {
      const existing = this.nodeVisuals.get(node.id)
      if (existing) {
        const stateKeysChanged =
          existing.node.version !== node.version ||
          JSON.stringify(existing.node.state) !== JSON.stringify(node.state) ||
          existing.node.role !== node.role

        existing.node = node
        existing.group.position.set(...node.position)

        // 若状态结构或版本演进，平滑重构海岛生态
        if (stateKeysChanged) {
          existing.group.remove(existing.assembly.rootGroup)
          this.disposeObject(existing.assembly.rootGroup)
          const newAssembly = generateIslandAssembly(node)
          existing.assembly = newAssembly
          existing.group.add(newAssembly.rootGroup)
          newAssembly.triggerJump() // 状态变迁引发岛民跳跃
        }

        this.updateNodeSprite(existing)
      } else {
        const visual = this.createNodeVisual(node)
        this.nodeVisuals.set(node.id, visual)
        this.scene.add(visual.group)
      }
    }

    // 6. 更新或创建海运航线（蓝色夜光水道）
    for (const edge of edges) {
      const fromNode = this.nodeVisuals.get(edge.from)
      const toNode = this.nodeVisuals.get(edge.to)
      if (!fromNode || !toNode) continue

      const existing = this.edgeVisuals.get(edge.id)
      if (existing) {
        existing.edge = edge
        const newCurve = this.createCubicCurve(fromNode.group.position, toNode.group.position)
        existing.curve = newCurve
        existing.lineMesh.geometry.dispose()
        existing.lineMesh.geometry = new THREE.TubeGeometry(newCurve, 40, 0.16, 8, false)
        ;(existing.lineMesh.material as THREE.MeshBasicMaterial).color.set(edge.color || '#38bdf8')
        ;(existing.arrowMesh.material as THREE.MeshBasicMaterial).color.set(edge.color || '#38bdf8')
        this.updateArrowTransform(existing.arrowMesh, newCurve)
      } else {
        const visual = this.createEdgeVisual(edge, fromNode.group.position, toNode.group.position)
        this.edgeVisuals.set(edge.id, visual)
        this.scene.add(visual.lineMesh)
        this.scene.add(visual.arrowMesh)
      }
    }
  }

  private createCommunityVisual(comm: CausalCommunity3D): CommunityVisual {
    const group = new THREE.Group()
    group.position.set(comm.center[0], 0.04, comm.center[2])

    // 群落海域洋流边界光环
    const ringGeo = new THREE.RingGeometry(comm.radius * 0.96, comm.radius, 64)
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(comm.color),
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2
    group.add(ring)

    // 群落全息海图标牌
    const sprite = this.createCommunitySprite(comm)
    sprite.position.set(0, 0.2, comm.radius + 3.0)
    group.add(sprite)

    return { group, ring, sprite, community: comm }
  }

  private createCommunitySprite(comm: CausalCommunity3D): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 440
    canvas.height = 68
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(7, 19, 34, 0.88)'
    ctx.strokeStyle = comm.color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(4, 4, 432, 60, 10)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 22px monospace'
    ctx.fillText(`🏝️ ${comm.name}`, 16, 38)
    ctx.fillStyle = comm.color
    ctx.font = '18px monospace'
    ctx.fillText(`${comm.nodeIds.length} 岛屿`, 340, 38)

    const texture = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(9.0, 1.4, 1)
    return sprite
  }

  private createNodeVisual(node: CausalNode3D): NodeVisual {
    const assembly = generateIslandAssembly(node)
    const group = new THREE.Group()
    group.position.set(...node.position)
    group.add(assembly.rootGroup)

    // 2D 状态徽标浮空置于小岛上方 (y = 5.2)
    const sprite = this.createNodeSprite(node)
    sprite.position.set(0, 5.2, 0)
    group.add(sprite)

    group.userData = { nodeId: node.id }
    assembly.rootGroup.userData = { nodeId: node.id }
    assembly.islandMesh.userData = { nodeId: node.id }

    return { group, assembly, sprite, node, glowIntensity: 0 }
  }

  private createNodeSprite(node: CausalNode3D): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 380
    canvas.height = 104
    const ctx = canvas.getContext('2d')!
    this.drawSpriteCanvas(ctx, node)

    const texture = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(7.6, 2.08, 1)
    sprite.userData = { canvas, texture }
    return sprite
  }

  private updateNodeSprite(visual: NodeVisual): void {
    const sprite = visual.sprite
    const { canvas, texture } = sprite.userData
    if (!canvas || !texture) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    this.drawSpriteCanvas(ctx, visual.node)
    texture.needsUpdate = true
  }

  private drawSpriteCanvas(ctx: CanvasRenderingContext2D, node: CausalNode3D): void {
    const isTarget = this.selectedNodeId === node.id
    const isUpstream = this.upstreamNodeIds.has(node.id)
    const isDownstream = this.downstreamNodeIds.has(node.id)

    const w = 376, h = 100
    const c = 12

    let strokeColor = node.color || '#38bdf8'
    let bgColor = 'rgba(7, 16, 30, 0.94)'
    if (isTarget) {
      strokeColor = '#ffffff'
      bgColor = 'rgba(15, 30, 55, 0.98)'
    } else if (isUpstream) {
      strokeColor = '#00f0ff'
      bgColor = 'rgba(6, 28, 48, 0.96)'
    } else if (isDownstream) {
      strokeColor = '#ffaa00'
      bgColor = 'rgba(40, 24, 6, 0.96)'
    }

    ctx.fillStyle = bgColor
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = isTarget ? 3.5 : (node.isHub ? 2.5 : 1.8)

    ctx.beginPath()
    ctx.moveTo(c, 2)
    ctx.lineTo(w - c, 2)
    ctx.lineTo(w - 2, c)
    ctx.lineTo(w - 2, h - c)
    ctx.lineTo(w - c, h - 2)
    ctx.lineTo(c, h - 2)
    ctx.lineTo(2, h - c)
    ctx.lineTo(2, c)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    // 顶部航海字符艺术装饰
    ctx.font = 'bold 12px monospace'
    if (isTarget) {
      ctx.fillStyle = '#ffffff'
      ctx.fillText('★ [ISLAND: SELECTED TARGET] ──────────★', 14, 24)
    } else if (isUpstream) {
      ctx.fillStyle = '#00f0ff'
      ctx.fillText('▲ [UPSTREAM: CAUSAL INFLOW] ──────────▲', 14, 24)
    } else if (isDownstream) {
      ctx.fillStyle = '#ffaa00'
      ctx.fillText('▼ [DOWNSTREAM: CAUSAL OUTFLOW] ────────▼', 14, 24)
    } else {
      ctx.fillStyle = strokeColor
      if (node.role === 'observation') {
        ctx.fillText('┌──[▲ OBSERVATION LIGHTHOUSE]────────┐', 14, 24)
      } else if (node.role === 'execution') {
        ctx.fillText('┌──[▼ EXECUTION FISHING PIER]────────┐', 14, 24)
      } else {
        ctx.fillText('┌──[◈ PURE DOMAIN SETTLEMENT]────────┐', 14, 24)
      }
    }

    // 海岛主名称
    ctx.fillStyle = '#f8fafc'
    ctx.font = node.isHub ? 'bold 20px monospace' : 'bold 18px monospace'
    const namePrefix = node.isHub ? '👑 ' : ''
    ctx.fillText(`${namePrefix}${node.name || node.id}`, 18, 54)

    // 生态代次与度数
    ctx.fillStyle = '#94a3b8'
    ctx.font = '13px monospace'
    const genText = node.generation !== null ? `G:${node.generation}` : 'G:--'
    const degText = `IN:${node.inDegree || 0} OUT:${node.outDegree || 0}`
    const verText = `v${node.version}`
    ctx.fillText(`[${genText} · ${verText}] [${degText}]`, 18, 82)

    // 活跃度指示
    const isRunning = node.status === 'RUNNING'
    ctx.fillStyle = isRunning ? '#22c55e' : (node.status === 'DROPPED' ? '#ef4444' : strokeColor)
    ctx.font = 'bold 13px monospace'
    ctx.fillText(isRunning ? '[● SAILING]' : '[● ANCHORED]', 260, 82)
  }

  private createEdgeVisual(
    edge: CausalEdge3D,
    fromPos: THREE.Vector3,
    toPos: THREE.Vector3,
  ): EdgeVisual {
    const isStalk = Boolean(edge.isVerticalStalk)
    const curve = isStalk
      ? new THREE.CubicBezierCurve3(
          fromPos.clone(),
          new THREE.Vector3(fromPos.x, fromPos.y * 0.67 + toPos.y * 0.33, fromPos.z),
          new THREE.Vector3(toPos.x, fromPos.y * 0.33 + toPos.y * 0.67, toPos.z),
          toPos.clone(),
        )
      : this.createCubicCurve(fromPos, toPos)

    const tubeRadius = isStalk ? 0.06 : 0.16
    const tubeGeo = new THREE.TubeGeometry(curve, isStalk ? 24 : 40, tubeRadius, 8, false)
    const lineMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(edge.color || '#38bdf8'),
      transparent: true,
      opacity: isStalk ? 0.6 : 0.5,
    })
    const lineMesh = new THREE.Mesh(tubeGeo, lineMat)

    const arrowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(edge.color || '#38bdf8'),
      transparent: true,
      opacity: 0.75,
    })
    const arrowMesh = new THREE.Mesh(this.sharedArrowGeo, arrowMat)
    arrowMesh.scale.set(0.55, 0.55, 0.55)
    this.updateArrowTransform(arrowMesh, curve)

    return { lineMesh, arrowMesh, curve, edge, glowIntensity: 0 }
  }

  /**
   * 触发航运通道发光与帆船起航（由真实的 ctx.send 遥测触发）
   */
  public triggerInfoTransmission(
    fromNodeId: string,
    toNodeId: string,
    infoType: string,
    payloadSummary?: string,
  ): void {
    let targetVisual: EdgeVisual | undefined
    for (const visual of this.edgeVisuals.values()) {
      if (visual.edge.from === fromNodeId && visual.edge.to === toNodeId) {
        targetVisual = visual
        break
      }
    }

    const fromNode = this.nodeVisuals.get(fromNodeId)

    if (targetVisual) {
      targetVisual.glowIntensity = 1.0
      ;(targetVisual.lineMesh.material as THREE.MeshBasicMaterial).opacity = 0.95
      ;(targetVisual.arrowMesh.material as THREE.MeshBasicMaterial).opacity = 1.0

      // 启航体素小帆船飞驰跨海
      const pulseId = `boat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      this.spawnBoat(targetVisual.curve, pulseId, infoType, toNodeId, targetVisual.edge.color, payloadSummary)
    }

    if (fromNode) {
      fromNode.glowIntensity = 0.8
      fromNode.assembly.triggerJump()
    }
  }

  private spawnBoat(
    curve: THREE.CubicBezierCurve3,
    pulseId: string,
    infoType: string,
    targetNodeId: string,
    color?: string,
    payloadSummary?: string,
  ): void {
    if (this.boats.length >= CausalScene3D.MAX_BOATS) {
      const oldest = this.boats.shift()!
      this.scene.remove(oldest.mesh)
      this.disposeObject(oldest.mesh)
    }

    const boatMesh = createVoxelBoat(infoType, color || '#38bdf8')
    this.scene.add(boatMesh)

    const pulse: PhotonPulse = {
      id: pulseId,
      edgeId: '',
      from: [curve.v0.x, curve.v0.y, curve.v0.z],
      to: [curve.v3.x, curve.v3.y, curve.v3.z],
      progress: 0,
      speed: 0.016, // 平稳航海速度
      color: color || '#38bdf8',
      infoType,
      payloadSummary,
    }

    this.boats.push({ pulse, mesh: boatMesh, curve, targetNodeId })
  }

  /**
   * 触发目标海岛接收货物震荡波与岛民欢呼
   */
  public triggerNodeImpact(nodeId: string): void {
    const visual = this.nodeVisuals.get(nodeId)
    if (!visual) return

    visual.glowIntensity = 1.0
    visual.assembly.triggerJump() // 目标岛民欢欣跳跃

    if (this.shockwaves.length >= CausalScene3D.MAX_SHOCKWAVES) {
      const oldest = this.shockwaves.shift()!
      this.scene.remove(oldest.mesh)
      if (oldest.mesh.material) {
        ;(oldest.mesh.material as THREE.Material).dispose()
      }
    }

    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(visual.node.color || '#38bdf8'),
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    })
    const waveMesh = new THREE.Mesh(this.sharedShockwaveGeo, ringMat)
    waveMesh.position.set(visual.group.position.x, 0.06, visual.group.position.z)
    waveMesh.rotation.x = Math.PI / 2
    this.scene.add(waveMesh)

    const wave: Shockwave = {
      id: `wave-${Date.now()}`,
      nodeId,
      position: [visual.group.position.x, 0.06, visual.group.position.z],
      radius: 1.2,
      maxRadius: 5.5,
      opacity: 0.85,
      color: visual.node.color || '#38bdf8',
    }

    this.shockwaves.push({ wave, mesh: waveMesh })
  }

  /**
   * 双向 BFS 因果溯源算法
   */
  private computeCausalPaths(targetId: string): void {
    this.upstreamNodeIds.clear()
    this.downstreamNodeIds.clear()
    this.upstreamEdgeIds.clear()
    this.downstreamEdgeIds.clear()

    const inEdges = new Map<string, Array<{ from: string; edgeId: string }>>()
    const outEdges = new Map<string, Array<{ to: string; edgeId: string }>>()

    for (const [id, visual] of this.edgeVisuals.entries()) {
      if (visual.edge.isVerticalStalk) continue
      const { from, to } = visual.edge
      if (!inEdges.has(to)) inEdges.set(to, [])
      inEdges.get(to)!.push({ from, edgeId: id })
      if (!outEdges.has(from)) outEdges.set(from, [])
      outEdges.get(from)!.push({ to, edgeId: id })
    }

    // 1. 上游溯源
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

    // 2. 下游派生
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

  /**
   * 选中海岛高亮全景更新：
   * - 目标岛屿：高亮放大 1.2x
   * - 上游岛屿与航线：电光青流向 (#00f0ff)
   * - 下游岛屿与航线：赛博暖橙流向 (#ffaa00)
   * - 无关海岛：降为海雾朦胧微隐 (opacity 0.28)
   */
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

      this.updateNodeSprite(visual)
    }

    // 更新航线管网材质与颜色
    for (const [id, visual] of this.edgeVisuals.entries()) {
      const isUpstreamEdge = this.upstreamEdgeIds.has(id)
      const isDownstreamEdge = this.downstreamEdgeIds.has(id)
      const isStalk = Boolean(visual.edge.isVerticalStalk)
      const lineMat = visual.lineMesh.material as THREE.MeshBasicMaterial
      const arrowMat = visual.arrowMesh.material as THREE.MeshBasicMaterial

      if (isUpstreamEdge) {
        lineMat.color.set('#00f0ff')
        lineMat.opacity = 1.0
        arrowMat.color.set('#00f0ff')
        arrowMat.opacity = 1.0
      } else if (isDownstreamEdge) {
        lineMat.color.set('#ffaa00')
        lineMat.opacity = 1.0
        arrowMat.color.set('#ffaa00')
        arrowMat.opacity = 1.0
      } else if (nodeId) {
        lineMat.color.set('#1e293b')
        lineMat.opacity = isStalk ? 0.12 : 0.08
        arrowMat.opacity = 0.05
      } else {
        const defaultColor = new THREE.Color(visual.edge.color || '#38bdf8')
        lineMat.color.copy(defaultColor)
        lineMat.opacity = isStalk ? 0.6 : 0.5
        arrowMat.color.copy(defaultColor)
        arrowMat.opacity = 0.75
      }
    }
  }

  private onPointerDown(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.mouse, this.camera)
    const meshes: THREE.Object3D[] = []
    for (const visual of this.nodeVisuals.values()) {
      visual.assembly.rootGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          meshes.push(child)
        }
      })
    }

    const intersects = this.raycaster.intersectObjects(meshes, false)
    if (intersects.length > 0) {
      let curr: THREE.Object3D | null = intersects[0].object
      while (curr && !curr.userData?.nodeId) {
        curr = curr.parent
      }
      const nodeId = curr?.userData?.nodeId
      if (nodeId) {
        this.setSelectedNode(nodeId)
        if (this.onNodeSelectedCallback) {
          this.onNodeSelectedCallback(nodeId)
        }
        return
      }
    }

    this.setSelectedNode(null)
    if (this.onNodeSelectedCallback) {
      this.onNodeSelectedCallback(null)
    }
  }

  private onResize(): void {
    if (!this.container || this.isDisposed) return
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  private animate(): void {
    if (this.isDisposed) return
    this.animFrameId = requestAnimationFrame(this.animate)

    const time = this.clock.getElapsedTime()
    this.controls.update()

    // 1. 低多边形海洋水面波浪翻滚与阳光反射 (Faceted Sparkling Waves)
    if (this.oceanGeometry) {
      const posAttr = this.oceanGeometry.attributes.position
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i)
        const z = posAttr.getZ(i)
        const waveY =
          Math.sin(x * 0.05 + time * 1.5) * Math.cos(z * 0.05 + time * 1.2) * 0.42 +
          Math.sin(x * 0.11 - time * 2.1 + z * 0.07) * 0.18
        posAttr.setY(i, waveY)
      }
      posAttr.needsUpdate = true
      this.oceanGeometry.computeVertexNormals()
    }

    // 2. 漫天海云随风缓缓漂移 (Drifting Clouds)
    for (const cloud of this.clouds) {
      cloud.position.x += 0.03
      if (cloud.position.x > 260) {
        cloud.position.x = -260
      }
    }

    // 3. 更新每个海岛的周期性生态律动与岛民动作
    for (const visual of this.nodeVisuals.values()) {
      visual.assembly.updateEcosystem(time, visual.node.status === 'RUNNING')

      if (visual.glowIntensity > 0) {
        visual.glowIntensity -= 0.02
        if (visual.glowIntensity < 0) visual.glowIntensity = 0
      }
    }

    // 4. 边管网与发光渐隐
    for (const visual of this.edgeVisuals.values()) {
      if (visual.glowIntensity > 0) {
        visual.glowIntensity -= 0.015
        if (visual.glowIntensity < 0) visual.glowIntensity = 0
        const opacity = 0.5 + visual.glowIntensity * 0.45
        ;(visual.lineMesh.material as THREE.MeshBasicMaterial).opacity = opacity
        ;(visual.arrowMesh.material as THREE.MeshBasicMaterial).opacity = opacity
      }
    }

    // 5. 航行帆船更新 (Sailboats gliding & rocking on waves)
    for (let i = this.boats.length - 1; i >= 0; i--) {
      const bVisual = this.boats[i]
      const { pulse, mesh, curve, targetNodeId } = bVisual

      pulse.progress += pulse.speed

      if (pulse.progress >= 1.0) {
        this.scene.remove(mesh)
        this.disposeObject(mesh)
        this.boats.splice(i, 1)
        this.triggerNodeImpact(targetNodeId)
      } else {
        const pt = curve.getPointAt(pulse.progress)
        mesh.position.set(pt.x, 0.28 + Math.sin(time * 3 + pulse.progress * 10) * 0.04, pt.z)

        const tangent = curve.getTangentAt(pulse.progress).normalize()
        const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent)
        mesh.quaternion.copy(targetQuat)
        mesh.rotation.z += Math.sin(time * 5 + pulse.progress * 8) * 0.08
      }
    }

    // 6. 水面扩散涟漪 (Water Ripples)
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sVisual = this.shockwaves[i]
      const { wave, mesh } = sVisual
      wave.radius += 0.1
      wave.opacity -= 0.022

      if (wave.opacity <= 0) {
        this.scene.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        this.shockwaves.splice(i, 1)
      } else {
        const scale = wave.radius / 1.2
        mesh.scale.set(scale, scale, 1)
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, wave.opacity)
      }
    }

    this.renderer.render(this.scene, this.camera)
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

    this.sharedShockwaveGeo.dispose()
    this.sharedArrowGeo.dispose()
    if (this.oceanGeometry) this.oceanGeometry.dispose()
    if (this.skyMesh) {
      this.skyMesh.geometry.dispose()
      if (this.skyMesh.material) (this.skyMesh.material as THREE.Material).dispose()
    }
    for (const cloud of this.clouds) {
      this.disposeObject(cloud)
    }

    this.controls.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
  }
}

