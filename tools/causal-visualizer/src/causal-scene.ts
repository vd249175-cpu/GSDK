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
  group: THREE.Group
  dashedMesh: THREE.Mesh
  channelMesh: THREE.Mesh
  waypointMesh: THREE.Mesh
  arrowMesh: THREE.Mesh
  curve: THREE.CubicBezierCurve3
  edge: CausalEdge3D
  glowIntensity: number
  dashTexture: THREE.CanvasTexture
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

    // 2. 摄像机（海面高空俯瞰航海图视角）
    const width = container.clientWidth || window.innerWidth
    const height = container.clientHeight || window.innerHeight
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 650)
    this.camera.position.set(0, 36, 62)

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
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04 // 禁止仰视穿透海面，始终保持在海面上方俯瞰航海图

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
    this.camera.position.set(0, 36, 62)
    this.controls.update()
  }

  public focusNode(nodeId: string): void {
    const visual = this.nodeVisuals.get(nodeId)
    if (!visual) return
    const pos = visual.group.position
    this.controls.target.copy(pos)
    this.camera.position.set(pos.x, pos.y + 12, pos.z + 24)
    this.controls.update()
    if (visual.assembly.triggerLighthouseSweep) {
      visual.assembly.triggerLighthouseSweep()
    }
  }

  /**
   * 航海图连线虚线纹理生成器 (Nautical Chart Dashed Track Texture)
   */
  private createNauticalDashTexture(colorHex: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 16
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, 64, 16)

    // 绘制航海图虚线段（航运标志色与平滑圆角端头）
    ctx.fillStyle = colorHex || '#38bdf8'
    ctx.beginPath()
    ctx.roundRect(4, 2, 36, 12, 4)
    ctx.fill()

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    return texture
  }

  /**
   * 2D 水平面航海图连线曲线生成器 (Flat Nautical Sea-Chart Curve)
   * 紧贴海平面 (Y=0.16)，施加水平法向微幅弯曲，杜绝立体空悬
   */
  private createNauticalCurve(fromPos: THREE.Vector3, toPos: THREE.Vector3, isStalk = false): THREE.CubicBezierCurve3 {
    const dx = toPos.x - fromPos.x
    const dz = toPos.z - fromPos.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    // 让航线从起点岛屿海岸线 (距离中心 ~2.8) 延伸至目标岛屿海岸线 (距离中心 ~2.8)
    const rFrom = Math.min(dist * 0.28, 2.8)
    const rTo = Math.min(dist * 0.28, 2.8)
    const ux = dx / Math.max(0.001, dist)
    const uz = dz / Math.max(0.001, dist)

    const startX = fromPos.x + ux * rFrom
    const startZ = fromPos.z + uz * rFrom
    const endX = toPos.x - ux * rTo
    const endZ = toPos.z - uz * rTo

    const midPoint = new THREE.Vector3((startX + endX) * 0.5, 0.16, (startZ + endZ) * 0.5)

    // 在水平海面 X-Z 上施加正交法向微幅弯曲，使航海图航线呈优雅弧线避开重叠
    const curvature = isStalk ? 0.0 : Math.min(0.12, 3.6 / Math.max(1, dist))
    const nx = -uz * curvature * dist
    const nz = ux * curvature * dist

    // 航海图航线统一紧贴海平面 (y = 0.16)
    const seaY = 0.16
    return new THREE.CubicBezierCurve3(
      new THREE.Vector3(startX, seaY, startZ),
      new THREE.Vector3(startX * 0.7 + midPoint.x * 0.3 + nx, seaY, startZ * 0.7 + midPoint.z * 0.3 + nz),
      new THREE.Vector3(endX * 0.7 + midPoint.x * 0.3 + nx, seaY, endZ * 0.7 + midPoint.z * 0.3 + nz),
      new THREE.Vector3(endX, seaY, endZ),
    )
  }

  private updateNauticalArrow(arrow: THREE.Mesh, curve: THREE.CubicBezierCurve3): void {
    const t = 0.82
    const pt = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t).normalize()

    arrow.position.set(pt.x, 0.18, pt.z)
    const angle = Math.atan2(tangent.x, tangent.z)
    arrow.rotation.set(0, angle, 0)
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
        this.scene.remove(visual.group)
        this.disposeObject(visual.group)
        visual.dashTexture.dispose()
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

    // 6. 更新或创建海运航线（航海图虚线连线）
    for (const edge of edges) {
      const fromNode = this.nodeVisuals.get(edge.from)
      const toNode = this.nodeVisuals.get(edge.to)
      if (!fromNode || !toNode) continue

      const existing = this.edgeVisuals.get(edge.id)
      if (existing) {
        existing.edge = edge
        const isStalk = Boolean(edge.isVerticalStalk)
        const newCurve = this.createNauticalCurve(fromNode.group.position, toNode.group.position, isStalk)
        existing.curve = newCurve

        existing.channelMesh.geometry.dispose()
        existing.channelMesh.geometry = new THREE.TubeGeometry(newCurve, isStalk ? 24 : 44, isStalk ? 0.08 : 0.18, 6, false)
        existing.dashedMesh.geometry.dispose()
        existing.dashedMesh.geometry = new THREE.TubeGeometry(newCurve, isStalk ? 24 : 44, isStalk ? 0.06 : 0.09, 6, false)

        const curveLength = newCurve.getLength()
        const dashRepeat = Math.max(3, Math.round(curveLength / 2.2))
        existing.dashTexture.repeat.set(dashRepeat, 1)

        const midPt = newCurve.getPointAt(0.5)
        existing.waypointMesh.position.set(midPt.x, 0.17, midPt.z)
        this.updateNauticalArrow(existing.arrowMesh, newCurve)

        const edgeColor = new THREE.Color(edge.color || '#38bdf8')
        ;(existing.channelMesh.material as THREE.MeshBasicMaterial).color.copy(edgeColor)
        ;(existing.waypointMesh.material as THREE.MeshBasicMaterial).color.copy(edgeColor)
        ;(existing.arrowMesh.material as THREE.MeshBasicMaterial).color.copy(edgeColor)
      } else {
        const visual = this.createEdgeVisual(edge, fromNode.group.position, toNode.group.position)
        this.edgeVisuals.set(edge.id, visual)
        this.scene.add(visual.group)
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

    // 2D 极简航海名标徽章置于小岛中央上方 (y = 3.6)
    const sprite = this.createNodeSprite(node)
    sprite.position.set(0, 3.6, 0)
    group.add(sprite)

    group.userData = { nodeId: node.id }
    assembly.rootGroup.userData = { nodeId: node.id }
    assembly.islandMesh.userData = { nodeId: node.id }

    return { group, assembly, sprite, node, glowIntensity: 0 }
  }

  private createNodeSprite(node: CausalNode3D): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 48
    const ctx = canvas.getContext('2d')!
    this.drawSpriteCanvas(ctx, node)

    const texture = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(3.2, 0.64, 1)
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

    const w = 240
    const h = 48
    ctx.clearRect(0, 0, w, h)

    let strokeColor = node.color || '#38bdf8'
    let bgColor = 'rgba(10, 25, 47, 0.82)'
    if (isTarget) {
      strokeColor = '#ffffff'
      bgColor = 'rgba(14, 116, 144, 0.94)'
    } else if (isUpstream) {
      strokeColor = '#00f0ff'
      bgColor = 'rgba(8, 47, 73, 0.90)'
    } else if (isDownstream) {
      strokeColor = '#ffaa00'
      bgColor = 'rgba(67, 20, 7, 0.90)'
    }

    // 优雅圆润海图胶囊名牌 (Pill Badge)
    ctx.fillStyle = bgColor
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = isTarget ? 2.8 : 1.6

    ctx.beginPath()
    ctx.roundRect(3, 3, w - 6, h - 6, 21)
    ctx.fill()
    ctx.stroke()

    // 角色地标图标
    let roleIcon = '🏝️'
    if (node.role === 'observation') roleIcon = '🔭'
    else if (node.role === 'execution') roleIcon = '🎣'
    else if (node.isHub) roleIcon = '👑'

    // 节点名称文字
    ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace'
    ctx.fillStyle = '#f8fafc'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const nameText = `${roleIcon} ${node.name || node.id}`
    const maxTextW = 185
    let truncated = nameText
    if (ctx.measureText(truncated).width > maxTextW) {
      while (truncated.length > 4 && ctx.measureText(truncated + '…').width > maxTextW) {
        truncated = truncated.slice(0, -1)
      }
      truncated += '…'
    }
    ctx.fillText(truncated, 14, h / 2)

    // 右侧运行/锚泊状态航标灯 (Navigation Pip)
    const isRunning = node.status === 'RUNNING'
    ctx.fillStyle = isRunning ? '#22c55e' : (node.status === 'DROPPED' ? '#ef4444' : strokeColor)
    ctx.beginPath()
    ctx.arc(w - 18, h / 2, 4.5, 0, Math.PI * 2)
    ctx.fill()
  }

  private createEdgeVisual(
    edge: CausalEdge3D,
    fromPos: THREE.Vector3,
    toPos: THREE.Vector3,
  ): EdgeVisual {
    const isStalk = Boolean(edge.isVerticalStalk)
    const curve = this.createNauticalCurve(fromPos, toPos, isStalk)
    const curveLength = curve.getLength()
    const colorHex = edge.color || '#38bdf8'

    const group = new THREE.Group()

    // 1. 航道水路基底浅色水槽 (Translucent Fairway Bed)
    const channelGeo = new THREE.TubeGeometry(curve, isStalk ? 24 : 44, isStalk ? 0.08 : 0.18, 6, false)
    const channelMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    })
    const channelMesh = new THREE.Mesh(channelGeo, channelMat)
    group.add(channelMesh)

    // 2. 航海图虚线轨迹 (Dashed Nautical Chart Route)
    const dashTexture = this.createNauticalDashTexture(colorHex)
    const dashRepeat = Math.max(3, Math.round(curveLength / 2.2))
    dashTexture.repeat.set(dashRepeat, 1)

    const dashedGeo = new THREE.TubeGeometry(curve, isStalk ? 24 : 44, isStalk ? 0.06 : 0.09, 6, false)
    const dashedMat = new THREE.MeshBasicMaterial({
      map: dashTexture,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const dashedMesh = new THREE.Mesh(dashedGeo, dashedMat)
    group.add(dashedMesh)

    // 3. 中途航海定位浮标圈 (Midpoint Navigational Waypoint Buoy)
    const waypointGeo = new THREE.RingGeometry(0.32, 0.48, 16)
    const waypointMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const waypointMesh = new THREE.Mesh(waypointGeo, waypointMat)
    waypointMesh.rotation.x = -Math.PI / 2
    const midPt = curve.getPointAt(0.5)
    waypointMesh.position.set(midPt.x, 0.17, midPt.z)
    group.add(waypointMesh)

    // 4. 航向箭头标 (Nautical Direction Chevron)
    const arrowGeo = new THREE.ConeGeometry(0.38, 0.85, 4)
    arrowGeo.rotateX(-Math.PI / 2)
    const arrowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: 0.85,
    })
    const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat)
    this.updateNauticalArrow(arrowMesh, curve)
    group.add(arrowMesh)

    return {
      group,
      dashedMesh,
      channelMesh,
      waypointMesh,
      arrowMesh,
      curve,
      edge,
      glowIntensity: 0,
      dashTexture,
    }
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
    const toNode = this.nodeVisuals.get(toNodeId)

    // 观察节点灯塔：仅在产生或接收观察事实信息时放光探海！
    if (fromNode?.assembly.triggerLighthouseSweep) {
      fromNode.assembly.triggerLighthouseSweep()
    }
    if (toNode?.assembly.triggerLighthouseSweep) {
      toNode.assembly.triggerLighthouseSweep()
    }

    if (targetVisual) {
      targetVisual.glowIntensity = 1.0
      ;(targetVisual.dashedMesh.material as THREE.MeshBasicMaterial).opacity = 1.0
      ;(targetVisual.channelMesh.material as THREE.MeshBasicMaterial).opacity = 0.45
      ;(targetVisual.waypointMesh.material as THREE.MeshBasicMaterial).opacity = 1.0

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
    if (visual.assembly.triggerLighthouseSweep) {
      visual.assembly.triggerLighthouseSweep()
    }

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
      const dashedMat = visual.dashedMesh.material as THREE.MeshBasicMaterial
      const channelMat = visual.channelMesh.material as THREE.MeshBasicMaterial
      const waypointMat = visual.waypointMesh.material as THREE.MeshBasicMaterial
      const arrowMat = visual.arrowMesh.material as THREE.MeshBasicMaterial

      if (isUpstreamEdge) {
        dashedMat.opacity = 1.0
        channelMat.color.set('#00f0ff')
        channelMat.opacity = 0.5
        waypointMat.color.set('#00f0ff')
        waypointMat.opacity = 1.0
        arrowMat.color.set('#00f0ff')
        arrowMat.opacity = 1.0
      } else if (isDownstreamEdge) {
        dashedMat.opacity = 1.0
        channelMat.color.set('#ffaa00')
        channelMat.opacity = 0.5
        waypointMat.color.set('#ffaa00')
        waypointMat.opacity = 1.0
        arrowMat.color.set('#ffaa00')
        arrowMat.opacity = 1.0
      } else if (nodeId) {
        dashedMat.opacity = 0.15
        channelMat.color.set('#1e293b')
        channelMat.opacity = 0.05
        waypointMat.opacity = 0.1
        arrowMat.opacity = 0.1
      } else {
        const defaultColor = new THREE.Color(visual.edge.color || '#38bdf8')
        dashedMat.opacity = 0.88
        channelMat.color.copy(defaultColor)
        channelMat.opacity = 0.16
        waypointMat.color.copy(defaultColor)
        waypointMat.opacity = 0.65
        arrowMat.color.copy(defaultColor)
        arrowMat.opacity = 0.85
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

    // 1. 低多边形海洋水面微幅波浪与阳光反射 (Gentle Faceted Waves)
    if (this.oceanGeometry) {
      const posAttr = this.oceanGeometry.attributes.position
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i)
        const z = posAttr.getZ(i)
        const waveY =
          Math.sin(x * 0.04 + time * 1.2) * Math.cos(z * 0.04 + time * 1.0) * 0.08 +
          Math.sin(x * 0.08 - time * 1.6 + z * 0.05) * 0.04
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

    // 4. 航海图航线流动洋流与发光渐隐
    for (const visual of this.edgeVisuals.values()) {
      visual.dashTexture.offset.x -= 0.005 * (1 + visual.glowIntensity * 2.8)

      if (visual.glowIntensity > 0) {
        visual.glowIntensity -= 0.015
        if (visual.glowIntensity < 0) visual.glowIntensity = 0
        ;(visual.dashedMesh.material as THREE.MeshBasicMaterial).opacity = 0.88 + visual.glowIntensity * 0.12
        ;(visual.channelMesh.material as THREE.MeshBasicMaterial).opacity = 0.16 + visual.glowIntensity * 0.35
        ;(visual.waypointMesh.material as THREE.MeshBasicMaterial).opacity = 0.65 + visual.glowIntensity * 0.35
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

