import type { CausalCommunity3D, CausalEdge3D, CausalNode3D } from '../../types'
import type { IVisualizerRenderer, RendererCallbacks } from '../renderer-interface'
import {
  computeSwissGridLayout,
  type SwissDashboardLayout,
  type SwissEdgeLayout,
  type SwissNodeLayout,
} from './swiss-layout-engine'
import './swiss-styles.css'

interface SignalPulse {
  id: string
  edgeId: string
  points: Array<{ x: number; y: number }>
  progress: number // 0 ~ 1
  speed: number
  infoType: string
}

/**
 * 2D 瑞士先锋主义因果看板渲染引擎 (Swiss Modernist 2D Renderer)
 * 纯粹理性、极简功能主义、严苛网格排布、曼哈顿正交因果布线与高反差字重
 */
export class SwissModernist2DRenderer implements IVisualizerRenderer {
  private container: HTMLElement | null = null
  private callbacks: RendererCallbacks

  // DOM 容器层级
  private rootEl: HTMLDivElement | null = null
  private gridCanvas: HTMLCanvasElement | null = null
  private worldContainer: HTMLDivElement | null = null
  private columnsContainer: HTMLDivElement | null = null
  private svgLayer: SVGSVGElement | null = null
  private cardsContainer: HTMLDivElement | null = null
  private controlsContainer: HTMLDivElement | null = null

  // 当前拓扑缓存与计算结果
  private nodes: CausalNode3D[] = []
  private edges: CausalEdge3D[] = []
  private communities: CausalCommunity3D[] = []
  private layout: SwissDashboardLayout | null = null

  // 视口平移与缩放 (Pan & Zoom)
  private scale = 0.92
  private panX = 40
  private panY = 20
  private isDragging = false
  private dragStart = { x: 0, y: 0 }
  private panStart = { x: 0, y: 0 }

  // 选中态与因果链路
  private selectedNodeId: string | null = null
  private upstreamNodeIds = new Set<string>()
  private downstreamNodeIds = new Set<string>()
  private upstreamEdgeIds = new Set<string>()
  private downstreamEdgeIds = new Set<string>()

  // 瞬时信号脉冲队列
  private pulses: SignalPulse[] = []
  private animFrameId?: number
  private isDisposed = false

  constructor(callbacks: RendererCallbacks = {}) {
    this.callbacks = callbacks
  }

  public mount(container: HTMLElement): void {
    this.container = container

    // 1. 根视口
    this.rootEl = document.createElement('div')
    this.rootEl.className = 'swiss-viewport-root'

    // 2. 0.5px 建筑底格与十字对齐准星 Canvas
    this.gridCanvas = document.createElement('canvas')
    this.gridCanvas.className = 'swiss-grid-canvas'
    this.rootEl.appendChild(this.gridCanvas)

    // 3. 2D 平移缩放世界容器
    this.worldContainer = document.createElement('div')
    this.worldContainer.className = 'swiss-world-container'

    // 列标头
    this.columnsContainer = document.createElement('div')
    this.columnsContainer.className = 'swiss-columns-header'
    this.worldContainer.appendChild(this.columnsContainer)

    // SVG 曼哈顿正交布线层
    this.svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svgLayer.setAttribute('class', 'swiss-svg-layer')
    this.worldContainer.appendChild(this.svgLayer)

    // 卡片 DOM 容器
    this.cardsContainer = document.createElement('div')
    this.worldContainer.appendChild(this.cardsContainer)

    this.rootEl.appendChild(this.worldContainer)

    // 4. 浮动平移缩放控制坞
    this.createControlsDock()

    container.appendChild(this.rootEl)

    // 5. 事件绑定 (Pan & Zoom)
    this.bindEvents()

    // 6. 初始渲染底格与帧循环
    this.resize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight)
    this.updateTransform()

    this.animate = this.animate.bind(this)
    this.animate()
  }

  private createControlsDock(): void {
    this.controlsContainer = document.createElement('div')
    this.controlsContainer.className = 'swiss-viewport-controls'

    const zoomOutBtn = document.createElement('button')
    zoomOutBtn.className = 'swiss-zoom-btn'
    zoomOutBtn.textContent = '−'
    zoomOutBtn.title = '缩小画布'
    zoomOutBtn.onclick = () => this.zoomStep(-0.15)

    const zoomLabel = document.createElement('span')
    zoomLabel.className = 'swiss-zoom-level'
    zoomLabel.textContent = `${Math.round(this.scale * 100)}%`

    const zoomInBtn = document.createElement('button')
    zoomInBtn.className = 'swiss-zoom-btn'
    zoomInBtn.textContent = '+'
    zoomInBtn.title = '放大画布'
    zoomInBtn.onclick = () => this.zoomStep(0.15)

    const resetBtn = document.createElement('button')
    resetBtn.className = 'swiss-zoom-btn'
    resetBtn.textContent = '⌂'
    resetBtn.title = '居中重置'
    resetBtn.onclick = () => this.returnToOverview()

    this.controlsContainer.appendChild(zoomOutBtn)
    this.controlsContainer.appendChild(zoomLabel)
    this.controlsContainer.appendChild(zoomInBtn)
    this.controlsContainer.appendChild(resetBtn)

    this.rootEl?.appendChild(this.controlsContainer)
  }

  private zoomStep(delta: number): void {
    const next = Math.max(0.35, Math.min(2.5, this.scale + delta))
    this.scale = next
    this.updateTransform()
  }

  private bindEvents(): void {
    if (!this.rootEl) return

    // 滚轮缩放
    this.rootEl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const zoomDelta = -e.deltaY * 0.0012
        const prevScale = this.scale
        const nextScale = Math.max(0.35, Math.min(2.5, prevScale + zoomDelta))

        // 以鼠标位置为中心平滑缩放
        const rect = this.rootEl!.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        this.panX = mouseX - ((mouseX - this.panX) / prevScale) * nextScale
        this.panY = mouseY - ((mouseY - this.panY) / prevScale) * nextScale
        this.scale = nextScale

        this.updateTransform()
      },
      { passive: false },
    )

    // 鼠标拖拽平移
    this.rootEl.addEventListener('pointerdown', (e) => {
      // 若点击的是卡片自身，不触发平移
      if ((e.target as HTMLElement).closest('.swiss-node-card')) return

      this.isDragging = true
      this.dragStart = { x: e.clientX, y: e.clientY }
      this.panStart = { x: this.panX, y: this.panY }
      this.rootEl?.setPointerCapture(e.pointerId)
    })

    this.rootEl.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return
      const dx = e.clientX - this.dragStart.x
      const dy = e.clientY - this.dragStart.y
      this.panX = this.panStart.x + dx
      this.panY = this.panStart.y + dy
      this.updateTransform()
    })

    this.rootEl.addEventListener('pointerup', (e) => {
      if (this.isDragging) {
        const dist = Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y)
        this.isDragging = false
        this.rootEl?.releasePointerCapture(e.pointerId)

        // 单击空白处取消选中
        if (dist < 4 && this.selectedNodeId) {
          this.setSelectedNode(null)
          this.callbacks.onNodeSelect?.(null)
        }
      }
    })

    // 单击空白背景直接取消选中
    this.rootEl.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.swiss-node-card')) return
      if ((e.target as HTMLElement).closest('.swiss-viewport-controls')) return
      if (this.selectedNodeId) {
        this.setSelectedNode(null)
        this.callbacks.onNodeSelect?.(null)
      }
    })
  }

  private updateTransform(): void {
    if (this.worldContainer) {
      this.worldContainer.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0) scale(${this.scale})`
    }
    const label = this.controlsContainer?.querySelector('.swiss-zoom-level')
    if (label) {
      label.textContent = `${Math.round(this.scale * 100)}%`
    }
    this.drawBackgroundGrid()
  }

  private drawBackgroundGrid(): void {
    if (!this.gridCanvas || !this.container) return
    const ctx = this.gridCanvas.getContext('2d')
    if (!ctx) return

    const w = this.gridCanvas.width
    const h = this.gridCanvas.height
    ctx.clearRect(0, 0, w, h)

    const gridSize = 32 * this.scale
    const offsetX = (this.panX % gridSize + gridSize) % gridSize
    const offsetY = (this.panY % gridSize + gridSize) % gridSize

    // 0.5px 极细微米灰度网格
    ctx.lineWidth = 0.6
    ctx.strokeStyle = 'rgba(10, 10, 10, 0.04)'

    ctx.beginPath()
    for (let x = offsetX; x < w; x += gridSize) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
    }
    for (let y = offsetY; y < h; y += gridSize) {
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
    }
    ctx.stroke()

    // 瑞士十字准星标尺 (+)
    ctx.strokeStyle = 'rgba(10, 10, 10, 0.12)'
    ctx.lineWidth = 1.0
    const crossGap = gridSize * 4
    for (let x = offsetX; x < w; x += crossGap) {
      for (let y = offsetY; y < h; y += crossGap) {
        ctx.beginPath()
        ctx.moveTo(x - 4, y)
        ctx.lineTo(x + 4, y)
        ctx.moveTo(x, y - 4)
        ctx.lineTo(x, y + 4)
        ctx.stroke()
      }
    }
  }

  public updateTopology(
    nodes: CausalNode3D[],
    edges: CausalEdge3D[],
    communities: CausalCommunity3D[],
  ): void {
    this.nodes = nodes
    this.edges = edges
    this.communities = communities

    this.layout = computeSwissGridLayout(nodes, edges, communities)
    this.renderColumns()
    this.renderSvgEdges()
    this.renderCards()

    if (this.selectedNodeId) {
      this.setSelectedNode(this.selectedNodeId)
    }
  }

  private renderColumns(): void {
    if (!this.columnsContainer || !this.layout) return
    this.columnsContainer.innerHTML = ''

    for (const col of this.layout.columns) {
      const colEl = document.createElement('div')
      colEl.className = 'swiss-column-badge'
      colEl.style.left = `${col.x}px`
      colEl.style.width = `${col.width}px`

      colEl.innerHTML = `
        <div class="swiss-col-title">${col.title}</div>
        <div class="swiss-col-sub">${col.subtitle}</div>
      `
      this.columnsContainer.appendChild(colEl)
    }
  }

  private renderSvgEdges(): void {
    if (!this.svgLayer || !this.layout) return
    this.svgLayer.innerHTML = ''

    const bounds = this.layout.bounds
    this.svgLayer.setAttribute('width', `${bounds.width + 400}`)
    this.svgLayer.setAttribute('height', `${bounds.height + 400}`)

    // 渲染正交 90 度连接线
    for (const edge of this.layout.edges) {
      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      pathEl.setAttribute('d', edge.svgPath)
      pathEl.setAttribute('id', `swiss-edge-${edge.id}`)
      pathEl.setAttribute('class', 'swiss-orthogonal-line')
      this.svgLayer.appendChild(pathEl)
    }
  }

  private renderCards(): void {
    if (!this.cardsContainer || !this.layout) return
    this.cardsContainer.innerHTML = ''

    for (const item of this.layout.nodes) {
      const card = document.createElement('div')
      card.id = `swiss-node-${item.nodeId}`
      card.className = `swiss-node-card ${item.role}`
      card.style.left = `${item.x}px`
      card.style.top = `${item.y}px`
      card.style.width = `${item.width}px`
      card.style.height = `${item.height}px`

      const node = item.node
      const roleLabel = item.role === 'observation' ? '▲ OBS / 感知' : item.role === 'execution' ? '▼ EXEC / 动作' : '◈ DOM / 领域'
      const isRunning = node.status === 'RUNNING'

      // 提取前两条关键状态属性
      const stateEntries = Object.entries(node.state || {}).slice(0, 2)

      card.innerHTML = `
        <div class="swiss-card-top">
          <span class="swiss-role-pill ${item.role}">${roleLabel}</span>
          <span class="swiss-gen-tag">GEN.0${node.generation ?? 0}</span>
        </div>
        <div class="swiss-card-main">
          <div class="swiss-card-name" title="${node.name || node.id}">${node.name || node.id}</div>
          <div class="swiss-card-ver">v${node.version}</div>
        </div>
        <div class="swiss-card-table">
          <div class="swiss-table-row">
            <span class="swiss-table-key">STATUS</span>
            <span class="swiss-table-val ${isRunning ? 'status-running' : 'status-idle'}">
              ${isRunning ? 'ACTIVE' : 'IDLE'}
            </span>
          </div>
          ${stateEntries
            .map(
              ([k, v]) => `
            <div class="swiss-table-row">
              <span class="swiss-table-key">${k.toUpperCase().slice(0, 10)}</span>
              <span class="swiss-table-val">${typeof v === 'object' ? '{...}' : String(v).slice(0, 10)}</span>
            </div>
          `,
            )
            .join('')}
        </div>
      `

      card.onclick = (e) => {
        e.stopPropagation()
        const nextId = this.selectedNodeId === item.nodeId ? null : item.nodeId
        this.setSelectedNode(nextId)
        this.callbacks.onNodeSelect?.(nextId)
      }

      this.cardsContainer.appendChild(card)
    }
  }

  public triggerInfoTransmission(
    fromNodeId: string,
    toNodeId: string,
    infoType: string,
    _payloadSummary?: string,
  ): void {
    if (!this.layout) return
    const edge = this.layout.edges.find((e) => e.from === fromNodeId && e.to === toNodeId)
    if (!edge) return

    const pulse: SignalPulse = {
      id: `${edge.id}-${Date.now()}`,
      edgeId: edge.id,
      points: edge.points,
      progress: 0.0,
      speed: 0.035,
      infoType,
    }
    this.pulses.push(pulse)

    // 触发发送端微米跳动
    this.triggerNodeImpact(fromNodeId)
  }

  public triggerNodeImpact(nodeId: string): void {
    const card = this.cardsContainer?.querySelector<HTMLElement>(`#swiss-node-${nodeId}`)
    if (card) {
      card.classList.remove('impact-flash')
      void card.offsetWidth
      card.classList.add('impact-flash')
    }
  }

  public setSelectedNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId
    this.upstreamNodeIds.clear()
    this.downstreamNodeIds.clear()
    this.upstreamEdgeIds.clear()
    this.downstreamEdgeIds.clear()

    if (nodeId && this.layout) {
      this.computeCausalPaths(nodeId)
    }

    // 更新卡片样式
    if (this.cardsContainer && this.layout) {
      for (const item of this.layout.nodes) {
        const el = this.cardsContainer.querySelector<HTMLElement>(`#swiss-node-${item.nodeId}`)
        if (!el) continue

        el.classList.remove('selected', 'upstream', 'downstream', 'dimmed')
        if (item.nodeId === nodeId) {
          el.classList.add('selected')
        } else if (this.upstreamNodeIds.has(item.nodeId)) {
          el.classList.add('upstream')
        } else if (this.downstreamNodeIds.has(item.nodeId)) {
          el.classList.add('downstream')
        } else if (nodeId) {
          el.classList.add('dimmed')
        }
      }
    }

    // 更新正交折线样式
    if (this.svgLayer && this.layout) {
      for (const edge of this.layout.edges) {
        const el = this.svgLayer.querySelector<SVGPathElement>(`#swiss-edge-${edge.id}`)
        if (!el) continue

        el.setAttribute('class', 'swiss-orthogonal-line')
        if (this.upstreamEdgeIds.has(edge.id)) {
          el.classList.add('upstream')
        } else if (this.downstreamEdgeIds.has(edge.id)) {
          el.classList.add('downstream')
        } else if (nodeId) {
          el.classList.add('dimmed')
        }
      }
    }
  }

  private computeCausalPaths(targetId: string): void {
    if (!this.layout) return
    const inEdges = new Map<string, Array<{ from: string; edgeId: string }>>()
    const outEdges = new Map<string, Array<{ to: string; edgeId: string }>>()

    for (const edge of this.layout.edges) {
      const { from, to, id } = edge
      if (!inEdges.has(to)) inEdges.set(to, [])
      inEdges.get(to)!.push({ from, edgeId: id })
      if (!outEdges.has(from)) outEdges.set(from, [])
      outEdges.get(from)!.push({ to, edgeId: id })
    }

    // 上游溯源 (Klein Blue)
    const upQueue = [targetId]
    const upVisited = new Set<string>([targetId])
    while (upQueue.length > 0) {
      const curr = upQueue.shift()!
      const preds = inEdges.get(curr) || []
      for (const { from, edgeId } of preds) {
        this.upstreamEdgeIds.add(edgeId)
        if (!upVisited.has(from)) {
          upVisited.add(from)
          this.upstreamNodeIds.add(from)
          upQueue.push(from)
        }
      }
    }

    // 下游扩散 (Vermilion)
    const downQueue = [targetId]
    const downVisited = new Set<string>([targetId])
    while (downQueue.length > 0) {
      const curr = downQueue.shift()!
      const succs = outEdges.get(curr) || []
      for (const { to, edgeId } of succs) {
        this.downstreamEdgeIds.add(edgeId)
        if (!downVisited.has(to)) {
          downVisited.add(to)
          this.downstreamNodeIds.add(to)
          downQueue.push(to)
        }
      }
    }
  }

  public focusNode(nodeId: string): void {
    if (!this.layout || !this.container) return
    const item = this.layout.nodes.find((n) => n.nodeId === nodeId)
    if (!item) return

    this.setSelectedNode(nodeId)

    // 平滑平移至该卡片居中
    const centerX = this.container.clientWidth / 2 - (item.x + item.width / 2) * this.scale
    const centerY = this.container.clientHeight / 2 - (item.y + item.height / 2) * this.scale
    this.panX = centerX
    this.panY = centerY
    this.updateTransform()
  }

  public returnToOverview(): void {
    this.scale = 0.92
    this.panX = 40
    this.panY = 20
    this.setSelectedNode(null)
    this.callbacks.onNodeSelect?.(null)
    this.updateTransform()
  }

  public setAutoRotate(_enabled: boolean): void {
    // 2D 瑞士看板保持平面静态严谨，不支持自转
  }

  public resize(width: number, height: number): void {
    if (this.gridCanvas) {
      this.gridCanvas.width = width
      this.gridCanvas.height = height
      this.drawBackgroundGrid()
    }
  }

  private animate(): void {
    if (this.isDisposed) return
    this.animFrameId = requestAnimationFrame(this.animate)

    // 渲染脉冲信号小光球
    if (this.pulses.length > 0 && this.svgLayer) {
      // 移除旧脉冲 DOM
      const existing = this.svgLayer.querySelectorAll('.swiss-signal-pulse')
      existing.forEach((e) => e.remove())

      for (let i = this.pulses.length - 1; i >= 0; i--) {
        const p = this.pulses[i]
        p.progress += p.speed

        if (p.progress >= 1.0) {
          this.pulses.splice(i, 1)
          continue
        }

        // 计算折线当前坐标
        const pt = this.interpolatePolyline(p.points, p.progress)
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        dot.setAttribute('cx', `${pt.x}`)
        dot.setAttribute('cy', `${pt.y}`)
        dot.setAttribute('r', '4.5')
        dot.setAttribute('class', 'swiss-signal-pulse')
        this.svgLayer.appendChild(dot)
      }
    }
  }

  private interpolatePolyline(
    points: Array<{ x: number; y: number }>,
    t: number,
  ): { x: number; y: number } {
    if (points.length === 0) return { x: 0, y: 0 }
    if (points.length === 1) return points[0]

    let totalLen = 0
    const segmentLens: number[] = []
    for (let i = 0; i < points.length - 1; i++) {
      const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
      segmentLens.push(len)
      totalLen += len
    }

    const targetDist = totalLen * Math.min(1, Math.max(0, t))
    let accumulated = 0
    for (let i = 0; i < segmentLens.length; i++) {
      const segLen = segmentLens[i]
      if (accumulated + segLen >= targetDist) {
        const segT = segLen === 0 ? 0 : (targetDist - accumulated) / segLen
        return {
          x: points[i].x + (points[i + 1].x - points[i].x) * segT,
          y: points[i].y + (points[i + 1].y - points[i].y) * segT,
        }
      }
      accumulated += segLen
    }

    return points[points.length - 1]
  }

  public dispose(): void {
    this.isDisposed = true
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId)

    if (this.rootEl?.parentNode) {
      this.rootEl.parentNode.removeChild(this.rootEl)
    }
    this.rootEl = null
    this.gridCanvas = null
    this.worldContainer = null
    this.svgLayer = null
    this.cardsContainer = null
    this.controlsContainer = null
    this.container = null
  }
}
