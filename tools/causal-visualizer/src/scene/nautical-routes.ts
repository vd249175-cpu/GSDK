import * as THREE from 'three'
import type { CausalEdge3D, PhotonPulse, Shockwave } from '../types'
import { createVoxelBoat } from '../voxel-models'

export interface EdgeVisual {
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

export interface BoatVisual {
  pulse: PhotonPulse
  mesh: THREE.Group
  curve: THREE.CubicBezierCurve3
  targetNodeId: string
}

export interface ShockwaveVisual {
  wave: Shockwave
  mesh: THREE.Mesh
}

export class NauticalRoutesManager {
  private scene: THREE.Scene
  private edgeVisuals = new Map<string, EdgeVisual>()
  private boats: BoatVisual[] = []
  private shockwaves: ShockwaveVisual[] = []

  private sharedShockwaveGeo = new THREE.RingGeometry(1.2, 1.8, 32)
  private static readonly MAX_BOATS = 30
  private static readonly MAX_SHOCKWAVES = 12

  private onBoatDeliveredCallback?: (targetNodeId: string) => void

  constructor(scene: THREE.Scene, onBoatDelivered?: (targetNodeId: string) => void) {
    this.scene = scene
    this.onBoatDeliveredCallback = onBoatDelivered
  }

  public getEdgeVisuals(): Map<string, EdgeVisual> {
    return this.edgeVisuals
  }

  public updateEdges(edges: CausalEdge3D[], getNodePos: (id: string) => THREE.Vector3 | undefined): void {
    const currentEdgeIds = new Set(edges.map((e) => e.id))

    // 清理已移除航线
    for (const [id, visual] of this.edgeVisuals.entries()) {
      if (!currentEdgeIds.has(id)) {
        this.scene.remove(visual.group)
        this.disposeEdgeVisual(visual)
        this.edgeVisuals.delete(id)
      }
    }

    // 增量同步更新每条航运航线
    for (const edge of edges) {
      const fromPos = getNodePos(edge.from)
      const toPos = getNodePos(edge.to)
      if (!fromPos || !toPos) continue

      const existing = this.edgeVisuals.get(edge.id)
      if (existing) {
        existing.edge = edge
        const isStalk = Boolean(edge.isVerticalStalk)
        const newCurve = this.createNauticalCurve(fromPos, toPos, isStalk)
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
        const visual = this.createEdgeVisual(edge, fromPos, toPos)
        this.edgeVisuals.set(edge.id, visual)
        this.scene.add(visual.group)
      }
    }
  }

  public highlightRoutes(
    upstreamEdgeIds: Set<string>,
    downstreamEdgeIds: Set<string>,
    activeNodeId: string | null,
  ): void {
    for (const [id, visual] of this.edgeVisuals.entries()) {
      const isUpstream = upstreamEdgeIds.has(id)
      const isDownstream = downstreamEdgeIds.has(id)
      const dashedMat = visual.dashedMesh.material as THREE.MeshBasicMaterial
      const channelMat = visual.channelMesh.material as THREE.MeshBasicMaterial
      const waypointMat = visual.waypointMesh.material as THREE.MeshBasicMaterial
      const arrowMat = visual.arrowMesh.material as THREE.MeshBasicMaterial

      if (isUpstream) {
        dashedMat.opacity = 1.0
        channelMat.color.set('#00f0ff')
        channelMat.opacity = 0.5
        waypointMat.color.set('#00f0ff')
        waypointMat.opacity = 1.0
        arrowMat.color.set('#00f0ff')
        arrowMat.opacity = 1.0
      } else if (isDownstream) {
        dashedMat.opacity = 1.0
        channelMat.color.set('#ffaa00')
        channelMat.opacity = 0.5
        waypointMat.color.set('#ffaa00')
        waypointMat.opacity = 1.0
        arrowMat.color.set('#ffaa00')
        arrowMat.opacity = 1.0
      } else if (activeNodeId) {
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

  public triggerTransmission(
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

    if (targetVisual) {
      targetVisual.glowIntensity = 1.0
      ;(targetVisual.dashedMesh.material as THREE.MeshBasicMaterial).opacity = 1.0
      ;(targetVisual.channelMesh.material as THREE.MeshBasicMaterial).opacity = 0.45
      ;(targetVisual.waypointMesh.material as THREE.MeshBasicMaterial).opacity = 1.0

      const pulseId = `boat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      this.spawnBoat(targetVisual.curve, pulseId, infoType, toNodeId, targetVisual.edge.color, payloadSummary)
    }
  }

  public triggerShockwave(pos: THREE.Vector3, color: string, nodeId: string): void {
    if (this.shockwaves.length >= NauticalRoutesManager.MAX_SHOCKWAVES) {
      const oldest = this.shockwaves.shift()!
      this.scene.remove(oldest.mesh)
      if (oldest.mesh.material) (oldest.mesh.material as THREE.Material).dispose()
    }

    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color || '#38bdf8'),
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    })
    const waveMesh = new THREE.Mesh(this.sharedShockwaveGeo, ringMat)
    waveMesh.position.set(pos.x, 0.06, pos.z)
    waveMesh.rotation.x = Math.PI / 2
    this.scene.add(waveMesh)

    const wave: Shockwave = {
      id: `wave-${Date.now()}`,
      nodeId,
      position: [pos.x, 0.06, pos.z],
      radius: 1.2,
      maxRadius: 5.5,
      opacity: 0.85,
      color: color || '#38bdf8',
    }
    this.shockwaves.push({ wave, mesh: waveMesh })
  }

  private spawnBoat(
    curve: THREE.CubicBezierCurve3,
    pulseId: string,
    infoType: string,
    targetNodeId: string,
    color?: string,
    payloadSummary?: string,
  ): void {
    if (this.boats.length >= NauticalRoutesManager.MAX_BOATS) {
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
      speed: 0.016,
      color: color || '#38bdf8',
      infoType,
      payloadSummary,
    }

    this.boats.push({ pulse, mesh: boatMesh, curve, targetNodeId })
  }

  public update(time: number): void {
    // 1. 航海图航线流动洋流与发光渐隐
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

    // 2. 帆船平稳航行
    for (let i = this.boats.length - 1; i >= 0; i--) {
      const bVisual = this.boats[i]
      const { pulse, mesh, curve, targetNodeId } = bVisual

      pulse.progress += pulse.speed

      if (pulse.progress >= 1.0) {
        this.scene.remove(mesh)
        this.disposeObject(mesh)
        this.boats.splice(i, 1)
        this.onBoatDeliveredCallback?.(targetNodeId)
      } else {
        const pt = curve.getPointAt(pulse.progress)
        mesh.position.set(pt.x, 0.28 + Math.sin(time * 3 + pulse.progress * 10) * 0.04, pt.z)

        const tangent = curve.getTangentAt(pulse.progress).normalize()
        const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent)
        mesh.quaternion.copy(targetQuat)
        mesh.rotation.z += Math.sin(time * 5 + pulse.progress * 8) * 0.08
      }
    }

    // 3. 水面扩散涟漪
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
  }

  private createEdgeVisual(edge: CausalEdge3D, fromPos: THREE.Vector3, toPos: THREE.Vector3): EdgeVisual {
    const isStalk = Boolean(edge.isVerticalStalk)
    const curve = this.createNauticalCurve(fromPos, toPos, isStalk)
    const curveLength = curve.getLength()
    const colorHex = edge.color || '#38bdf8'

    const group = new THREE.Group()

    const channelGeo = new THREE.TubeGeometry(curve, isStalk ? 24 : 44, isStalk ? 0.08 : 0.18, 6, false)
    const channelMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    })
    const channelMesh = new THREE.Mesh(channelGeo, channelMat)
    group.add(channelMesh)

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

  private createNauticalCurve(from: THREE.Vector3, to: THREE.Vector3, isStalk: boolean): THREE.CubicBezierCurve3 {
    const seaY = 0.16
    const p0 = new THREE.Vector3(from.x, seaY, from.z)
    const p3 = new THREE.Vector3(to.x, seaY, to.z)

    if (isStalk) {
      return new THREE.CubicBezierCurve3(
        p0,
        new THREE.Vector3(p0.x, seaY + 0.1, p0.z),
        new THREE.Vector3(p3.x, seaY + 0.1, p3.z),
        p3,
      )
    }

    const dist = p0.distanceTo(p3)
    const mid = new THREE.Vector3().addVectors(p0, p3).multiplyScalar(0.5)
    const dir = new THREE.Vector3().subVectors(p3, p0).normalize()
    const normal = new THREE.Vector3(-dir.z, 0, dir.x)
    const seed = Math.sin(p0.x * 12.9898 + p3.z * 78.233)
    const lateralOffset = normal.multiplyScalar(seed * Math.min(dist * 0.18, 5.0))

    const cp1 = new THREE.Vector3().lerpVectors(p0, mid, 0.55).add(lateralOffset)
    cp1.y = seaY + 0.02
    const cp2 = new THREE.Vector3().lerpVectors(mid, p3, 0.45).add(lateralOffset)
    cp2.y = seaY + 0.02

    return new THREE.CubicBezierCurve3(p0, cp1, cp2, p3)
  }

  private updateNauticalArrow(arrowMesh: THREE.Mesh, curve: THREE.CubicBezierCurve3): void {
    const pt = curve.getPointAt(0.55)
    arrowMesh.position.set(pt.x, 0.22, pt.z)
    const tangent = curve.getTangentAt(0.55).normalize()
    const rot = new THREE.Matrix4().lookAt(tangent, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0))
    arrowMesh.quaternion.setFromRotationMatrix(rot)
  }

  private createNauticalDashTexture(colorHex: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 16
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, 64, 16)

    ctx.fillStyle = colorHex
    ctx.shadowColor = colorHex
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.roundRect(4, 3, 34, 10, 4)
    ctx.fill()

    ctx.shadowBlur = 0
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.roundRect(8, 5, 18, 6, 2)
    ctx.fill()

    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    return texture
  }

  private disposeEdgeVisual(visual: EdgeVisual): void {
    visual.channelMesh.geometry.dispose()
    ;(visual.channelMesh.material as THREE.Material).dispose()
    visual.dashedMesh.geometry.dispose()
    ;(visual.dashedMesh.material as THREE.Material).dispose()
    visual.waypointMesh.geometry.dispose()
    ;(visual.waypointMesh.material as THREE.Material).dispose()
    visual.arrowMesh.geometry.dispose()
    ;(visual.arrowMesh.material as THREE.Material).dispose()
    visual.dashTexture.dispose()
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
    this.sharedShockwaveGeo.dispose()
    for (const visual of this.edgeVisuals.values()) {
      this.scene.remove(visual.group)
      this.disposeEdgeVisual(visual)
    }
    this.edgeVisuals.clear()

    for (const boat of this.boats) {
      this.scene.remove(boat.mesh)
      this.disposeObject(boat.mesh)
    }
    this.boats = []

    for (const wave of this.shockwaves) {
      this.scene.remove(wave.mesh)
      wave.mesh.geometry.dispose()
      ;(wave.mesh.material as THREE.Material).dispose()
    }
    this.shockwaves = []
  }
}
