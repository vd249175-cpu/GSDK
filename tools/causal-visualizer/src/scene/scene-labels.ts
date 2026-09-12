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
   * 创建海岛节点的头顶悬浮名牌 Sprite (羊皮纸/白砂木牌航海风)
   */
  public static createNodeSprite(node: CausalNode3D): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 280
    canvas.height = 56
    const ctx = canvas.getContext('2d')!
    this.drawSpriteCanvas(ctx, node, false, false, false)

    const texture = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(3.5, 0.7, 1)
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
    const w = 280
    const h = 56
    ctx.clearRect(0, 0, w, h)

    // 默认：暖砂象牙羊皮纸质感
    let bgColor = 'rgba(255, 252, 245, 0.94)'
    let strokeColor = 'rgba(180, 83, 9, 0.45)'
    let textColor = '#1e293b'

    if (isTarget) {
      // 聚焦小岛：阳光琥珀金
      bgColor = 'rgba(254, 243, 199, 0.98)'
      strokeColor = '#d97706'
      textColor = '#78350f'
    } else if (isUpstream) {
      // 上游源头：清爽群岛海蓝
      bgColor = 'rgba(224, 242, 254, 0.96)'
      strokeColor = '#0284c7'
      textColor = '#0369a1'
    } else if (isDownstream) {
      // 下游去向：落日珊瑚暖橙
      bgColor = 'rgba(255, 237, 213, 0.96)'
      strokeColor = '#ea580c'
      textColor = '#9a3412'
    }

    // 1. 柔和木牌投影
    ctx.shadowColor = 'rgba(69, 26, 3, 0.18)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 3

    // 2. 圆角胶囊名牌基底
    ctx.fillStyle = bgColor
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = isTarget ? 3.0 : 1.8

    ctx.beginPath()
    ctx.roundRect(4, 4, w - 8, h - 8, 24)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.stroke()

    // 3. 海岛角色专属可爱图标
    let roleIcon = '🏡'
    if (node.role === 'observation') roleIcon = '🔭'
    else if (node.role === 'execution') roleIcon = '🎣'
    else if (node.isHub) roleIcon = '👑'

    // 4. 标题文字
    ctx.font = 'bold 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif'
    ctx.fillStyle = textColor
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const nameText = `${roleIcon} ${node.name || node.id}`
    const maxTextW = 210
    let truncated = nameText
    if (ctx.measureText(truncated).width > maxTextW) {
      while (truncated.length > 4 && ctx.measureText(truncated + '…').width > maxTextW) {
        truncated = truncated.slice(0, -1)
      }
      truncated += '…'
    }
    ctx.fillText(truncated, 16, h / 2)

    // 5. 状态航海浮标原点 (绿: 潮汐起伏推进中, 红: 离线, 橙: 静默等待)
    const isRunning = node.status === 'RUNNING'
    ctx.fillStyle = isRunning ? '#16a34a' : node.status === 'DROPPED' ? '#dc2626' : '#d97706'
    ctx.beginPath()
    ctx.arc(w - 20, h / 2, 5, 0, Math.PI * 2)
    ctx.fill()
  }

  /**
   * 创建环礁群落 (Community) 的光圈与标注标牌
   */
  public static createCommunityVisual(comm: CausalCommunity3D): CommunityVisual {
    const group = new THREE.Group()
    group.position.set(comm.center[0], 0.04, comm.center[2])

    // 环礁水面光圈（清澈蓝绿浅滩色）
    const ringGeo = new THREE.RingGeometry(comm.radius * 0.96, comm.radius, 64)
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(comm.color || '#38bdf8'),
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2
    group.add(ring)

    const sprite = this.createCommunitySprite(comm)
    sprite.position.set(0, 0.2, comm.radius + 3.2)
    group.add(sprite)

    return { group, ring, sprite, community: comm }
  }

  private static createCommunitySprite(comm: CausalCommunity3D): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 460
    canvas.height = 70
    const ctx = canvas.getContext('2d')!

    // 航海羊皮纸群落铭牌
    ctx.shadowColor = 'rgba(69, 26, 3, 0.2)'
    ctx.shadowBlur = 10
    ctx.shadowOffsetY = 4

    ctx.fillStyle = 'rgba(255, 252, 245, 0.95)'
    ctx.strokeStyle = '#b45309'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.roundRect(5, 5, 450, 60, 16)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.stroke()

    ctx.fillStyle = '#451a03'
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(`🏝️ ${comm.name}`, 18, 40)

    ctx.fillStyle = '#b45309'
    ctx.font = 'bold 18px monospace'
    ctx.textAlign = 'right'
    ctx.fillText(`${comm.nodeIds.length} 座岛屿`, 432, 40)

    const texture = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.set(9.2, 1.4, 1)
    return sprite
  }
}
