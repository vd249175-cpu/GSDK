import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { CausalCommunity3D, CausalEdge3D, CausalNode3D, PhotonPulse, Shockwave } from './types'

interface NodeVisual {
  group: THREE.Group
  core: THREE.Mesh
  ring: THREE.Mesh
  ring2?: THREE.Mesh
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

interface PhotonVisual {
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

  private static readonly MAX_PHOTONS = 30
  private static readonly MAX_SHOCKWAVES = 12

  private sharedPhotonCoreGeo = new THREE.SphereGeometry(0.36, 12, 12)
  private sharedPhotonHaloGeo = new THREE.SphereGeometry(0.8, 12, 12)
  private sharedShockwaveGeo = new THREE.RingGeometry(1.2, 1.6, 32)
  private sharedArrowGeo = new THREE.ConeGeometry(0.55, 1.4, 12)

  private nodeVisuals = new Map<string, NodeVisual>()
  private edgeVisuals = new Map<string, EdgeVisual>()
  private communityVisuals = new Map<string, CommunityVisual>()
  private photons: PhotonVisual[] = []
  private shockwaves: ShockwaveVisual[] = []
  private stars?: THREE.Points
  private polarGrid?: THREE.PolarGridHelper

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

    // 1. 场景
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#030712') // 黑曜石极深深空
    this.scene.fog = new THREE.FogExp2('#030712', 0.007)

    // 2. 摄像机
    const width = container.clientWidth || window.innerWidth
    const height = container.clientHeight || window.innerHeight
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 600)
    this.camera.position.set(0, 30, 62)

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
    this.controls.maxDistance = 250
    this.controls.minDistance = 6

    // 5. 光源
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2)
    this.scene.add(ambientLight)

    const dirLight = new THREE.DirectionalLight(0x00f0ff, 2.4) // 极氪电光青定向光
    dirLight.position.set(40, 60, 40)
    this.scene.add(dirLight)

    const dirLight2 = new THREE.DirectionalLight(0xa855f7, 2.0) // 幽光紫补光
    dirLight2.position.set(-40, -20, -40)
    this.scene.add(dirLight2)

    // 6. 极客全息极坐标网格基盘 (Cyber Polar Grid)
    this.polarGrid = new THREE.PolarGridHelper(120, 16, 8, 64, 0x00f0ff, 0x1e293b)
    this.polarGrid.position.y = -14
    ;(this.polarGrid.material as THREE.Material).transparent = true
    ;(this.polarGrid.material as THREE.Material).opacity = 0.22
    this.scene.add(this.polarGrid)

    // 7. 星空粒子
    this.initStars()

    // 8. 事件绑定
    this.onResize = this.onResize.bind(this)
    this.onPointerDown = this.onPointerDown.bind(this)
    window.addEventListener('resize', this.onResize)
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)

    // 9. 启动渲染循环
    this.animate = this.animate.bind(this)
    this.animate()
  }

  private initStars(): void {
    const starGeo = new THREE.BufferGeometry()
    const starCount = 1800
    const starPos = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount * 3; i += 3) {
      starPos[i] = (Math.random() - 0.5) * 320
      starPos[i + 1] = (Math.random() - 0.5) * 200
      starPos[i + 2] = (Math.random() - 0.5) * 320
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    const starMat = new THREE.PointsMaterial({
      color: 0x64748b,
      size: 0.8,
      transparent: true,
      opacity: 0.55,
    })
    this.stars = new THREE.Points(starGeo, starMat)
    this.scene.add(this.stars)
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
    const dist = fromPos.distanceTo(toPos)
    // 根据两节点距离给予 3D 悬垂拱起弧度
    midPoint.y += Math.max(3.2, dist * 0.2)

    return new THREE.CubicBezierCurve3(
      fromPos.clone(),
      new THREE.Vector3(fromPos.x * 0.75 + midPoint.x * 0.25, fromPos.y + 1.8, fromPos.z * 0.75 + midPoint.z * 0.25),
      new THREE.Vector3(toPos.x * 0.75 + midPoint.x * 0.25, toPos.y + 1.8, toPos.z * 0.75 + midPoint.z * 0.25),
      toPos.clone(),
    )
  }

  private updateArrowTransform(arrow: THREE.Mesh, curve: THREE.CubicBezierCurve3): void {
    const t = 0.82
    const pt = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t).normalize()

    arrow.position.copy(pt)
    const defaultDir = new THREE.Vector3(0, 1, 0)
    const quat = new THREE.Quaternion().setFromUnitVectors(defaultDir, tangent)
    arrow.quaternion.copy(quat)
  }

  /**
   * 图无关拓扑更新：接收任意节点、边与社区聚类并更新 3D 场景
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

    // 2. 更新或创建社区星云基座
    for (const comm of communities) {
      if (comm.nodeIds.length <= 1) continue // 单节点小群落不画外围大环
      const existing = this.communityVisuals.get(comm.id)
      if (existing) {
        existing.community = comm
        existing.group.position.set(comm.center[0], comm.center[1] - 3.2, comm.center[2])
      } else {
        const visual = this.createCommunityVisual(comm)
        this.communityVisuals.set(comm.id, visual)
        this.scene.add(visual.group)
      }
    }

    // 3. 移除已消失的节点
    for (const [id, visual] of this.nodeVisuals.entries()) {
      if (!currentNodes.has(id)) {
        this.scene.remove(visual.group)
        this.disposeObject(visual.group)
        this.nodeVisuals.delete(id)
      }
    }

    // 4. 移除已消失的边
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

    // 5. 更新或创建节点
    for (const node of nodes) {
      const existing = this.nodeVisuals.get(node.id)
      if (existing) {
        existing.node = node
        existing.group.position.set(...node.position)
        this.updateNodeSprite(existing)
      } else {
        const visual = this.createNodeVisual(node)
        this.nodeVisuals.set(node.id, visual)
        this.scene.add(visual.group)
      }
    }

    // 6. 更新或创建边（粗管径 0.22 + 箭头锥体）
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
        existing.lineMesh.geometry = new THREE.TubeGeometry(newCurve, 48, 0.24, 8, false)
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
    group.position.set(comm.center[0], comm.center[1] - 3.2, comm.center[2])

    // 群落全息底盘环
    const ringGeo = new THREE.RingGeometry(comm.radius * 0.96, comm.radius, 64)
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(comm.color),
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2
    group.add(ring)

    // 群落全息标题 Sprite
    const sprite = this.createCommunitySprite(comm)
    sprite.position.set(0, 0, comm.radius + 3.0)
    group.add(sprite)

    return { group, ring, sprite, community: comm }
  }

  private createCommunitySprite(comm: CausalCommunity3D): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 440
    canvas.height = 68
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)'
    ctx.strokeStyle = comm.color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(4, 4, 432, 60, 10)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 22px monospace'
    ctx.fillText(`🪐 ${comm.name}`, 16, 38)
    ctx.fillStyle = comm.color
    ctx.font = '18px monospace'
    ctx.fillText(`${comm.nodeIds.length} 节点`, 340, 38)

    const texture = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(9.0, 1.4, 1)
    return sprite
  }

  private createNodeVisual(node: CausalNode3D): NodeVisual {
    const group = new THREE.Group()
    group.position.set(...node.position)

    const color = new THREE.Color(node.color || '#38bdf8')
    const isHub = Boolean(node.isHub)
    const role = node.role || 'domain'
    const coreRadius = isHub ? 1.6 : 1.15

    let core: THREE.Mesh

    if (role === 'observation') {
      // 观察层：向上锥体探测天线（极氪电光青，感官侦测）
      const coneGeo = new THREE.ConeGeometry(coreRadius * 0.9, coreRadius * 1.8, 4)
      const coreMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#00f0ff'),
        emissive: new THREE.Color('#00f0ff'),
        emissiveIntensity: 1.15,
        roughness: 0.15,
        metalness: 0.7,
      })
      core = new THREE.Mesh(coneGeo, coreMat)
      core.rotation.y = Math.PI / 4
    } else if (role === 'execution') {
      // 操作层：向下六角执行底座（赛博琥珀金，物理写下发）
      const cylGeo = new THREE.CylinderGeometry(coreRadius * 1.15, coreRadius * 0.55, coreRadius * 1.7, 6)
      const coreMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#f59e0b'),
        emissive: new THREE.Color('#f59e0b'),
        emissiveIntensity: 1.05,
        roughness: 0.2,
        metalness: 0.8,
      })
      core = new THREE.Mesh(cylGeo, coreMat)
    } else {
      // 纯领域核心：八面体赛博晶体（零 I/O 状态机）
      const octGeo = new THREE.OctahedronGeometry(coreRadius, 0)
      const coreMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: isHub ? 1.25 : 0.85,
        roughness: 0.1,
        metalness: 0.85,
      })
      core = new THREE.Mesh(octGeo, coreMat)
    }
    group.add(core)

    // 外围主全息能量环
    const ringRadius = isHub ? 2.3 : 1.7
    const ringGeo = new THREE.TorusGeometry(ringRadius, isHub ? 0.08 : 0.05, 16, 64)
    const ringMat = new THREE.MeshBasicMaterial({
      color: role === 'observation' ? new THREE.Color('#00f0ff') : (role === 'execution' ? new THREE.Color('#f59e0b') : color),
      transparent: true,
      opacity: isHub ? 0.85 : 0.6,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2
    group.add(ring)

    // 第二道线框反向偏角能量环（领域核心与 Hub 拥有双环陀螺仪姿态）
    let ring2: THREE.Mesh | undefined
    if (isHub || role === 'domain') {
      const ringGeo2 = new THREE.TorusGeometry(ringRadius * 1.25, 0.04, 16, 64)
      const ringMat2 = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
      })
      ring2 = new THREE.Mesh(ringGeo2, ringMat2)
      ring2.rotation.y = Math.PI / 3
      group.add(ring2)
    }

    // 2D 状态徽标
    const sprite = this.createNodeSprite(node)
    sprite.position.set(0, role === 'observation' ? 2.7 : (role === 'execution' ? -2.5 : 2.2), 0)
    group.add(sprite)

    group.userData = { nodeId: node.id }
    core.userData = { nodeId: node.id }

    return { group, core, ring, ring2, sprite, node, glowIntensity: 0 }
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
    const c = 12 // 极氪科技切角

    let strokeColor = node.color || '#38bdf8'
    let bgColor = 'rgba(7, 10, 18, 0.94)'
    if (isTarget) {
      strokeColor = '#ffffff'
      bgColor = 'rgba(15, 23, 42, 0.98)'
    } else if (isUpstream) {
      strokeColor = '#00f0ff'
      bgColor = 'rgba(6, 26, 40, 0.96)'
    } else if (isDownstream) {
      strokeColor = '#ffaa00'
      bgColor = 'rgba(38, 22, 6, 0.96)'
    }

    // 绘制多边形切角边框 (Chamfered Cyber HUD)
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

    // 顶部字符装饰徽标
    ctx.font = 'bold 12px monospace'
    if (isTarget) {
      ctx.fillStyle = '#ffffff'
      ctx.fillText('★ [TARGET: SELECTED] ──────────────────★', 14, 24)
    } else if (isUpstream) {
      ctx.fillStyle = '#00f0ff'
      ctx.fillText('▲ [UPSTREAM: CAUSAL INFLOW] ──────────▲', 14, 24)
    } else if (isDownstream) {
      ctx.fillStyle = '#ffaa00'
      ctx.fillText('▼ [DOWNSTREAM: CAUSAL OUTFLOW] ────────▼', 14, 24)
    } else {
      ctx.fillStyle = strokeColor
      if (node.role === 'observation') {
        ctx.fillText('┌──[▲ OBSERVATION WORLD]─────────────┐', 14, 24)
      } else if (node.role === 'execution') {
        ctx.fillText('┌──[▼ EXECUTION WORLD]───────────────┐', 14, 24)
      } else {
        ctx.fillText('┌──[◈ PURE DOMAIN CORE]──────────────┐', 14, 24)
      }
    }

    // 节点主名称
    ctx.fillStyle = '#f8fafc'
    ctx.font = node.isHub ? 'bold 20px monospace' : 'bold 18px monospace'
    const namePrefix = node.isHub ? '👑 ' : ''
    ctx.fillText(`${namePrefix}${node.name || node.id}`, 18, 54)

    // 状态与元数据（等宽字符艺术风格）
    ctx.fillStyle = '#94a3b8'
    ctx.font = '13px monospace'
    const genText = node.generation !== null ? `G:${node.generation}` : 'G:--'
    const degText = `IN:${node.inDegree || 0} OUT:${node.outDegree || 0}`
    const verText = `v${node.version}`
    ctx.fillText(`[${genText} · ${verText}] [${degText}]`, 18, 82)

    // 右下角运行状态字符
    const isRunning = node.status === 'RUNNING'
    ctx.fillStyle = isRunning ? '#22c55e' : (node.status === 'DROPPED' ? '#ef4444' : strokeColor)
    ctx.font = 'bold 13px monospace'
    ctx.fillText(isRunning ? '[● ACTIVE]' : '[● IDLE]', 276, 82)
  }

  private createEdgeVisual(
    edge: CausalEdge3D,
    fromPos: THREE.Vector3,
    toPos: THREE.Vector3,
  ): EdgeVisual {
    const isStalk = Boolean(edge.isVerticalStalk)
    // 垂直衍生细线使用笔直垂直过渡；普通因果管道使用优雅起伏的 3D 拱桥贝塞尔曲线
    const curve = isStalk
      ? new THREE.CubicBezierCurve3(
          fromPos.clone(),
          new THREE.Vector3(fromPos.x, fromPos.y * 0.67 + toPos.y * 0.33, fromPos.z),
          new THREE.Vector3(toPos.x, fromPos.y * 0.33 + toPos.y * 0.67, toPos.z),
          toPos.clone(),
        )
      : this.createCubicCurve(fromPos, toPos)

    // 垂直衍生细线管径 0.08，普通因果管径 0.22
    const tubeRadius = isStalk ? 0.08 : 0.22
    const tubeGeo = new THREE.TubeGeometry(curve, isStalk ? 24 : 48, tubeRadius, 8, false)
    const lineMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(edge.color || '#38bdf8'),
      transparent: true,
      opacity: isStalk ? 0.8 : 0.65,
    })
    const lineMesh = new THREE.Mesh(tubeGeo, lineMat)

    // 箭头指示锥体
    const arrowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(edge.color || '#38bdf8'),
      transparent: true,
      opacity: isStalk ? 0.65 : 0.85,
    })
    const arrowMesh = new THREE.Mesh(this.sharedArrowGeo, arrowMat)
    if (isStalk) {
      arrowMesh.scale.set(0.55, 0.55, 0.55)
    }
    this.updateArrowTransform(arrowMesh, curve)

    return { lineMesh, arrowMesh, curve, edge, glowIntensity: 0 }
  }

  /**
   * 触发边发光与光子飞驰（由真实的 ctx.send 遥测触发）
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
      // 1. 边高能强发光
      targetVisual.glowIntensity = 1.0
      ;(targetVisual.lineMesh.material as THREE.MeshBasicMaterial).opacity = 0.95
      ;(targetVisual.arrowMesh.material as THREE.MeshBasicMaterial).opacity = 1.0

      // 2. 发射光子脉冲
      const pulseId = `pulse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      this.spawnPhoton(targetVisual.curve, pulseId, infoType, toNodeId, payloadSummary)
    }

    if (fromNode) {
      fromNode.glowIntensity = 0.8
    }
  }

  private spawnPhoton(
    curve: THREE.CubicBezierCurve3,
    pulseId: string,
    infoType: string,
    targetNodeId: string,
    payloadSummary?: string,
  ): void {
    // 防爆流：限制并发光子脉冲上限，淘汰超量旧脉冲
    if (this.photons.length >= CausalScene3D.MAX_PHOTONS) {
      const oldest = this.photons.shift()!
      this.scene.remove(oldest.mesh)
      this.disposeObject(oldest.mesh)
    }

    const group = new THREE.Group()

    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const coreMesh = new THREE.Mesh(this.sharedPhotonCoreGeo, coreMat)
    group.add(coreMesh)

    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75,
    })
    const haloMesh = new THREE.Mesh(this.sharedPhotonHaloGeo, haloMat)
    group.add(haloMesh)

    this.scene.add(group)

    const pulse: PhotonPulse = {
      id: pulseId,
      edgeId: '',
      from: [curve.v0.x, curve.v0.y, curve.v0.z],
      to: [curve.v3.x, curve.v3.y, curve.v3.z],
      progress: 0,
      speed: 0.024,
      color: '#38bdf8',
      infoType,
      payloadSummary,
    }

    this.photons.push({ pulse, mesh: group, curve, targetNodeId })
  }

  /**
   * 触发目标节点吸收震荡波
   */
  public triggerNodeImpact(nodeId: string): void {
    const visual = this.nodeVisuals.get(nodeId)
    if (!visual) return

    visual.glowIntensity = 1.0

    // 防爆流：限制并发吸收冲击波上限
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
      opacity: 0.8,
      side: THREE.DoubleSide,
    })
    const waveMesh = new THREE.Mesh(this.sharedShockwaveGeo, ringMat)
    waveMesh.position.copy(visual.group.position)
    waveMesh.rotation.x = Math.PI / 2
    this.scene.add(waveMesh)

    const wave: Shockwave = {
      id: `wave-${Date.now()}`,
      nodeId,
      position: [visual.group.position.x, visual.group.position.y, visual.group.position.z],
      radius: 1.2,
      maxRadius: 4.8,
      opacity: 0.8,
      color: visual.node.color || '#38bdf8',
    }

    this.shockwaves.push({ wave, mesh: waveMesh })
  }

  /**
   * 双向 BFS 因果溯源算法：
   * 计算指定选中节点的全部上游入流集合 (Upstream / Inflow) 与后序派生出流集合 (Downstream / Outflow)
   */
  private computeCausalPaths(targetId: string): void {
    this.upstreamNodeIds.clear()
    this.downstreamNodeIds.clear()
    this.upstreamEdgeIds.clear()
    this.downstreamEdgeIds.clear()

    const inEdges = new Map<string, Array<{ from: string; edgeId: string }>>()
    const outEdges = new Map<string, Array<{ to: string; edgeId: string }>>()

    for (const [id, visual] of this.edgeVisuals.entries()) {
      if (visual.edge.isVerticalStalk) continue // 排除纯物理衍生细线，专注业务因果消息拓扑
      const { from, to } = visual.edge
      if (!inEdges.has(to)) inEdges.set(to, [])
      inEdges.get(to)!.push({ from, edgeId: id })
      if (!outEdges.has(from)) outEdges.set(from, [])
      outEdges.get(from)!.push({ to, edgeId: id })
    }

    // 1. 上游溯源 (BFS Backward)
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

    // 2. 下游派生 (BFS Forward)
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
   * 选中节点高亮全景更新：
   * - 目标节点：白金高亮光圈 + 放大倍率
   * - 上游链路：电光青高饱和聚光 (#00f0ff)，导管全开
   * - 下游链路：赛博金橙高饱和聚光 (#ffaa00)，导管全开
   * - 无关节点与边：降为 10%~15% 半透明暗灰线框
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

    // 更新节点材质、缩放与徽标
    for (const [id, visual] of this.nodeVisuals.entries()) {
      const isTarget = id === nodeId
      const isUpstream = this.upstreamNodeIds.has(id)
      const isDownstream = this.downstreamNodeIds.has(id)
      const isRelated = isTarget || isUpstream || isDownstream
      const isDimmed = Boolean(nodeId && !isRelated)

      const coreMat = visual.core.material as THREE.MeshStandardMaterial
      const ringMat = visual.ring.material as THREE.MeshBasicMaterial
      const ring2Mat = visual.ring2 ? (visual.ring2.material as THREE.MeshBasicMaterial) : undefined

      if (isTarget) {
        coreMat.emissive.set('#ffffff')
        coreMat.emissiveIntensity = 1.8
        coreMat.opacity = 1.0
        ringMat.color.set('#ffffff')
        ringMat.opacity = 1.0
        visual.group.scale.set(1.25, 1.25, 1.25)
      } else if (isUpstream) {
        coreMat.emissive.set('#00f0ff')
        coreMat.emissiveIntensity = 1.45
        coreMat.opacity = 1.0
        ringMat.color.set('#00f0ff')
        ringMat.opacity = 0.95
        visual.group.scale.set(1.12, 1.12, 1.12)
      } else if (isDownstream) {
        coreMat.emissive.set('#ffaa00')
        coreMat.emissiveIntensity = 1.45
        coreMat.opacity = 1.0
        ringMat.color.set('#ffaa00')
        ringMat.opacity = 0.95
        visual.group.scale.set(1.12, 1.12, 1.12)
      } else if (isDimmed) {
        coreMat.emissive.set('#1e293b')
        coreMat.emissiveIntensity = 0.1
        coreMat.opacity = 0.2
        ringMat.opacity = 0.12
        if (ring2Mat) ring2Mat.opacity = 0.08
        visual.group.scale.set(0.9, 0.9, 0.9)
      } else {
        // 恢复默认社区色与正常姿态
        const defaultColor = new THREE.Color(visual.node.color || '#38bdf8')
        coreMat.emissive.copy(defaultColor)
        coreMat.emissiveIntensity = visual.node.isHub ? 1.2 : 0.85
        coreMat.opacity = 1.0
        ringMat.color.copy(defaultColor)
        ringMat.opacity = visual.node.isHub ? 0.85 : 0.6
        if (ring2Mat) ring2Mat.opacity = 0.5
        visual.group.scale.set(1.0, 1.0, 1.0)
      }

      this.updateNodeSprite(visual)
    }

    // 更新边管网材质、透明度与颜色
    for (const [id, visual] of this.edgeVisuals.entries()) {
      const isUpstreamEdge = this.upstreamEdgeIds.has(id)
      const isDownstreamEdge = this.downstreamEdgeIds.has(id)
      const isStalk = Boolean(visual.edge.isVerticalStalk)
      const lineMat = visual.lineMesh.material as THREE.MeshBasicMaterial
      const arrowMat = visual.arrowMesh.material as THREE.MeshBasicMaterial

      if (isUpstreamEdge) {
        lineMat.color.set('#00f0ff') // 电光青高亮管网
        lineMat.opacity = 1.0
        arrowMat.color.set('#00f0ff')
        arrowMat.opacity = 1.0
      } else if (isDownstreamEdge) {
        lineMat.color.set('#ffaa00') // 赛博金橙高亮管网
        lineMat.opacity = 1.0
        arrowMat.color.set('#ffaa00')
        arrowMat.opacity = 1.0
      } else if (nodeId) {
        // 有选中节点但此边不属于因果链路，进行暗化弱化
        lineMat.color.set('#1e293b')
        lineMat.opacity = isStalk ? 0.12 : 0.08
        arrowMat.opacity = 0.05
      } else {
        // 默认恢复
        const defaultColor = new THREE.Color(visual.edge.color || '#38bdf8')
        lineMat.color.copy(defaultColor)
        lineMat.opacity = isStalk ? 0.8 : 0.65
        arrowMat.color.copy(defaultColor)
        arrowMat.opacity = isStalk ? 0.65 : 0.85
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
      meshes.push(visual.core)
    }

    const intersects = this.raycaster.intersectObjects(meshes, false)
    if (intersects.length > 0) {
      const hit = intersects[0].object
      const nodeId = hit.userData?.nodeId
      if (nodeId) {
        this.setSelectedNode(nodeId)
        if (this.onNodeSelectedCallback) {
          this.onNodeSelectedCallback(nodeId)
        }
      }
    } else {
      this.setSelectedNode(null)
      if (this.onNodeSelectedCallback) {
        this.onNodeSelectedCallback(null)
      }
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

    this.controls.update()

    if (this.stars) {
      this.stars.rotation.y += 0.0003
    }

    for (const visual of this.nodeVisuals.values()) {
      visual.ring.rotation.z += 0.015
      if (visual.ring2) {
        visual.ring2.rotation.x -= 0.02
      }

      if (visual.glowIntensity > 0) {
        visual.glowIntensity -= 0.02
        if (visual.glowIntensity < 0) visual.glowIntensity = 0
        const emissive = 0.8 + visual.glowIntensity * 1.5
        ;(visual.core.material as THREE.MeshStandardMaterial).emissiveIntensity = emissive
      }
    }

    for (const visual of this.edgeVisuals.values()) {
      if (visual.glowIntensity > 0) {
        visual.glowIntensity -= 0.015
        if (visual.glowIntensity < 0) visual.glowIntensity = 0
        const opacity = 0.65 + visual.glowIntensity * 0.35
        ;(visual.lineMesh.material as THREE.MeshBasicMaterial).opacity = opacity
        ;(visual.arrowMesh.material as THREE.MeshBasicMaterial).opacity = opacity
      }
    }

    for (let i = this.photons.length - 1; i >= 0; i--) {
      const pVisual = this.photons[i]
      const { pulse, mesh, curve, targetNodeId } = pVisual

      pulse.progress += pulse.speed

      if (pulse.progress >= 1.0) {
        this.scene.remove(mesh)
        this.photons.splice(i, 1)
        this.triggerNodeImpact(targetNodeId)
      } else {
        const pt = curve.getPointAt(pulse.progress)
        mesh.position.copy(pt)
        mesh.rotation.y += 0.05
      }
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sVisual = this.shockwaves[i]
      const { wave, mesh } = sVisual
      wave.radius += 0.12
      wave.opacity -= 0.025

      if (wave.opacity <= 0) {
        this.scene.remove(mesh)
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

    this.sharedPhotonCoreGeo.dispose()
    this.sharedPhotonHaloGeo.dispose()
    this.sharedShockwaveGeo.dispose()
    this.sharedArrowGeo.dispose()

    this.controls.dispose()
    this.renderer.dispose()
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
  }
}
