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
    this.scene.background = new THREE.Color('#07090e')
    this.scene.fog = new THREE.FogExp2('#07090e', 0.008)

    // 2. 摄像机
    const width = container.clientWidth || window.innerWidth
    const height = container.clientHeight || window.innerHeight
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 600)
    this.camera.position.set(0, 28, 56)

    // 3. 渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setSize(width, height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.3
    container.appendChild(this.renderer.domElement)

    // 4. 轨道控制器
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.maxDistance = 250
    this.controls.minDistance = 6

    // 5. 光源
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1)
    this.scene.add(ambientLight)

    const dirLight = new THREE.DirectionalLight(0x38bdf8, 2.2)
    dirLight.position.set(40, 60, 40)
    this.scene.add(dirLight)

    const dirLight2 = new THREE.DirectionalLight(0xa855f7, 1.8)
    dirLight2.position.set(-40, -20, -40)
    this.scene.add(dirLight2)

    // 6. 星空粒子
    this.initStars()

    // 7. 事件绑定
    this.onResize = this.onResize.bind(this)
    this.onPointerDown = this.onPointerDown.bind(this)
    window.addEventListener('resize', this.onResize)
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)

    // 8. 启动渲染循环
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

    // 核心球体（Hub 节点更大更亮）
    const coreRadius = isHub ? 1.6 : 1.15
    const coreGeo = new THREE.SphereGeometry(coreRadius, 32, 32)
    const coreMat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: isHub ? 1.1 : 0.8,
      roughness: 0.2,
      metalness: 0.5,
    })
    const core = new THREE.Mesh(coreGeo, coreMat)
    group.add(core)

    // 外围全息能量环
    const ringRadius = isHub ? 2.2 : 1.7
    const ringGeo = new THREE.TorusGeometry(ringRadius, isHub ? 0.08 : 0.05, 16, 64)
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: isHub ? 0.8 : 0.55,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2
    group.add(ring)

    // 若是 Hub 中枢，添加第二道反向偏角能量环
    let ring2: THREE.Mesh | undefined
    if (isHub) {
      const ringGeo2 = new THREE.TorusGeometry(2.7, 0.06, 16, 64)
      const ringMat2 = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6,
      })
      ring2 = new THREE.Mesh(ringGeo2, ringMat2)
      ring2.rotation.y = Math.PI / 3
      group.add(ring2)
    }

    // 2D 状态徽标
    const sprite = this.createNodeSprite(node)
    sprite.position.set(0, isHub ? 2.7 : 2.2, 0)
    group.add(sprite)

    group.userData = { nodeId: node.id }
    core.userData = { nodeId: node.id }

    return { group, core, ring, ring2, sprite, node, glowIntensity: 0 }
  }

  private createNodeSprite(node: CausalNode3D): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 340
    canvas.height = 100
    const ctx = canvas.getContext('2d')!
    this.drawSpriteCanvas(ctx, node)

    const texture = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(6.8, 2.0, 1)
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
    ctx.fillStyle = 'rgba(10, 14, 22, 0.90)'
    ctx.strokeStyle = node.color || '#38bdf8'
    ctx.lineWidth = node.isHub ? 4 : 2.5
    const x = 6, y = 6, w = 328, h = 88, r = 14
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    // 节点名称（Hub 带皇冠标识）
    ctx.fillStyle = '#ffffff'
    ctx.font = node.isHub ? 'bold 22px monospace' : 'bold 20px monospace'
    const nameStr = node.isHub ? `👑 ${node.name || node.id}` : (node.name || node.id)
    ctx.fillText(nameStr, 18, 40)

    // 代次、版本与度数
    ctx.fillStyle = '#94a3b8'
    ctx.font = '16px monospace'
    const genText = node.generation !== null ? `Gen ${node.generation}` : 'Dropped'
    const degText = `↓${node.inDegree || 0} ↑${node.outDegree || 0}`
    ctx.fillText(`${genText} · v${node.version} · ${degText}`, 18, 70)

    // 运行态光点
    ctx.fillStyle = node.status === 'RUNNING' ? '#22c55e' : (node.color || '#38bdf8')
    ctx.beginPath()
    ctx.arc(302, 50, node.isHub ? 9 : 7, 0, Math.PI * 2)
    ctx.fill()
  }

  private createEdgeVisual(
    edge: CausalEdge3D,
    fromPos: THREE.Vector3,
    toPos: THREE.Vector3,
  ): EdgeVisual {
    const curve = this.createCubicCurve(fromPos, toPos)
    // 粗管径 0.24，具有高辨识度与实体感
    const tubeGeo = new THREE.TubeGeometry(curve, 48, 0.24, 8, false)
    const lineMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(edge.color || '#38bdf8'),
      transparent: true,
      opacity: 0.65,
    })
    const lineMesh = new THREE.Mesh(tubeGeo, lineMat)

    // 箭头指示锥体
    const arrowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(edge.color || '#38bdf8'),
      transparent: true,
      opacity: 0.85,
    })
    const arrowMesh = new THREE.Mesh(this.sharedArrowGeo, arrowMat)
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
      if (nodeId && this.onNodeSelectedCallback) {
        this.onNodeSelectedCallback(nodeId)
      }
    } else {
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
