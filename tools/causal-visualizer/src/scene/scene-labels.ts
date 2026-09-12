import * as THREE from 'three'
import type { CausalCommunity3D, CausalNode3D } from '../types'

export interface CommunityVisual {
  group: THREE.Group
  ring: THREE.Mesh
  sprite: THREE.Sprite
  community: CausalCommunity3D
}

export class SceneLabelsManager {
  /**
   * 创建海岛节点的头顶悬浮名牌 Sprite
   */
  public static createNodeSprite(node: CausalNode3D): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 48
    const ctx = canvas.getContext('2d')!
    this.drawSpriteCanvas(ctx, node, false, false, false)

    const texture = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(3.2, 0.64, 1)
    sprite.userData = { canvas, texture }
    return sprite
  }

  /**
   * 刷新海岛节点悬浮名牌的选中/上下游高亮状态
   */
  public static updateNodeSprite(
    sprite: THREE.Sprite,
    node: CausalNode3D,
    isTarget: boolean,
    isUpstream: boolean,
    isDownstream: boolean,
  ): void {
    const { canvas, texture } = sprite.userData
    if (!canvas || !texture) return
    const ctx = (canvas as HTMLCanvasElement).getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    this.drawSpriteCanvas(ctx, node, isTarget, isUpstream, isDownstream)
    ;(texture as THREE.CanvasTexture).needsUpdate = true
  }

  private static drawSpriteCanvas(
    ctx: CanvasRenderingContext2D,
    node: CausalNode3D,
    isTarget: boolean,
    isUpstream: boolean,
    isDownstream: boolean,
  ): void {
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

    ctx.fillStyle = bgColor
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = isTarget ? 2.8 : 1.6

    ctx.beginPath()
    ctx.roundRect(3, 3, w - 6, h - 6, 21)
    ctx.fill()
    ctx.stroke()

    let roleIcon = '🏝️'
    if (node.role === 'observation') roleIcon = '🔭'
    else if (node.role === 'execution') roleIcon = '🎣'
    else if (node.isHub) roleIcon = '👑'

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

    const isRunning = node.status === 'RUNNING'
    ctx.fillStyle = isRunning ? '#22c55e' : node.status === 'DROPPED' ? '#ef4444' : strokeColor
    ctx.beginPath()
    ctx.arc(w - 18, h / 2, 4.5, 0, Math.PI * 2)
    ctx.fill()
  }

  /**
   * 创建环礁群落 (Community) 的光圈与标注标牌
   */
  public static createCommunityVisual(comm: CausalCommunity3D): CommunityVisual {
    const group = new THREE.Group()
    group.position.set(comm.center[0], 0.04, comm.center[2])

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

    const sprite = this.createCommunitySprite(comm)
    sprite.position.set(0, 0.2, comm.radius + 3.0)
    group.add(sprite)

    return { group, ring, sprite, community: comm }
  }

  private static createCommunitySprite(comm: CausalCommunity3D): THREE.Sprite {
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
}
