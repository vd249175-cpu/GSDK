import React, { useEffect, useRef, useState, useCallback } from 'react'
import { CausalScene3D } from './causal-scene'
import { computeGraphAgnosticLayout, type LayoutMode } from './layout-engine'
import { visualizerClient } from './visualizer-client'
import type { CausalCommunity3D, CausalEdge3D, CausalNode3D, CausalTelemetryEvent } from './types'
import './visualizer.css'

export function VisualizerApp() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CausalScene3D | null>(null)

  const [nodes, setNodes] = useState<CausalNode3D[]>([])
  const [edges, setEdges] = useState<CausalEdge3D[]>([])
  const [communities, setCommunities] = useState<CausalCommunity3D[]>([])
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('community')
  const [logs, setLogs] = useState<CausalTelemetryEvent[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [autoRotate, setAutoRotate] = useState(false)
  const [revision, setRevision] = useState(0)
  const [isConnected, setIsConnected] = useState(visualizerClient.connected)

  // 内部维护活跃节点与边的映射，确保图无关动态发现
  const nodesRef = useRef<CausalNode3D[]>([])
  const edgesRef = useRef<CausalEdge3D[]>([])
  const communitiesRef = useRef<CausalCommunity3D[]>([])
  const edgeSetRef = useRef<Set<string>>(new Set())
  const layoutModeRef = useRef<LayoutMode>('community')

  // 保持 layoutModeRef 与 state 同步
  layoutModeRef.current = layoutMode

  // 高频遥测防抖防爆流队列
  const pendingLogsRef = useRef<CausalTelemetryEvent[]>([])
  const logFlushRafRef = useRef<number | null>(null)
  const nodeUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layoutDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 批量合并日志更新，避免高频 React 重新渲染
  const enqueueLog = useCallback((event: CausalTelemetryEvent) => {
    pendingLogsRef.current.push(event)
    if (!logFlushRafRef.current) {
      logFlushRafRef.current = requestAnimationFrame(() => {
        logFlushRafRef.current = null
        if (pendingLogsRef.current.length > 0) {
          const batch = pendingLogsRef.current
          pendingLogsRef.current = []
          setLogs((prev) => [...batch.reverse(), ...prev].slice(0, 60))
        }
      })
    }
  }, [])

  // 节流节点属性更新（版本、状态），最高 80ms 一次 React 重绘
  const triggerThrottledNodeUpdate = useCallback(() => {
    if (!nodeUpdateTimerRef.current) {
      nodeUpdateTimerRef.current = setTimeout(() => {
        nodeUpdateTimerRef.current = null
        setNodes([...nodesRef.current])
        sceneRef.current?.updateTopology(nodesRef.current, edgesRef.current, communitiesRef.current)
      }, 80)
    }
  }, [])

  // 防抖拓扑重新排布（新边动态发现时），120ms 防抖
  const scheduleRelayout = useCallback(() => {
    if (layoutDebounceTimerRef.current) clearTimeout(layoutDebounceTimerRef.current)
    layoutDebounceTimerRef.current = setTimeout(() => {
      layoutDebounceTimerRef.current = null
      const rawNodes = nodesRef.current.map((n) => ({
        nodeId: n.id,
        generation: n.generation,
        version: n.version,
        status: n.status,
        state: n.state,
      }))
      const rawEdges = edgesRef.current.map((e) => ({
        from: e.from,
        to: e.to,
        infoType: e.lastInfoType,
      }))
      const layout = computeGraphAgnosticLayout(rawNodes, rawEdges, layoutModeRef.current)
      nodesRef.current = layout.nodes
      edgesRef.current = layout.edges
      communitiesRef.current = layout.communities
      setNodes([...layout.nodes])
      setEdges([...layout.edges])
      setCommunities([...layout.communities])
      sceneRef.current?.updateTopology(layout.nodes, layout.edges, layout.communities)
    }, 120)
  }, [])

  const syncTopology = useCallback(async () => {
    try {
      const snapshot = await visualizerClient.fetchLiveTopology()
      if (snapshot?.nodes && snapshot.nodes.length > 0) {
        setRevision(snapshot.revision)

        const rawEdges = (snapshot.routes || []).map((r) => ({
          from: r.from,
          to: r.to,
          infoType: r.infoType,
        }))

        // 保留运行时已发现的动态边
        for (const e of edgesRef.current) {
          if (!rawEdges.some((re) => re.from === e.from && re.to === e.to)) {
            rawEdges.push({ from: e.from, to: e.to, infoType: e.lastInfoType })
          }
        }

        const layout = computeGraphAgnosticLayout(snapshot.nodes, rawEdges, layoutModeRef.current)
        nodesRef.current = layout.nodes
        edgesRef.current = layout.edges
        communitiesRef.current = layout.communities
        edgeSetRef.current = new Set(layout.edges.map((e) => `${e.from}->${e.to}`))

        setNodes([...layout.nodes])
        setEdges([...layout.edges])
        setCommunities([...layout.communities])
        sceneRef.current?.updateTopology(layout.nodes, layout.edges, layout.communities)

        // 若初次拉取附带历史遥测且当前无日志，载入最近历史
        if (snapshot.recentEvents && snapshot.recentEvents.length > 0) {
          setLogs((prev) => (prev.length === 0 ? snapshot.recentEvents!.slice(0, 30) : prev))
        }
      }
    } catch (err) {
      console.warn('[VisualizerApp] Sync live topology fallback:', err)
    }
  }, [])

  const toggleLayoutMode = () => {
    const nextMode: LayoutMode = layoutMode === 'community' ? 'pipeline' : 'community'
    setLayoutMode(nextMode)
    layoutModeRef.current = nextMode

    const rawNodes = nodesRef.current.map((n) => ({
      nodeId: n.id,
      generation: n.generation,
      version: n.version,
      status: n.status,
      state: n.state,
    }))
    const rawEdges = edgesRef.current.map((e) => ({
      from: e.from,
      to: e.to,
      infoType: e.lastInfoType,
    }))
    const layout = computeGraphAgnosticLayout(rawNodes, rawEdges, nextMode)
    nodesRef.current = layout.nodes
    edgesRef.current = layout.edges
    communitiesRef.current = layout.communities
    setNodes([...layout.nodes])
    setEdges([...layout.edges])
    setCommunities([...layout.communities])
    sceneRef.current?.updateTopology(layout.nodes, layout.edges, layout.communities)
  }

  useEffect(() => {
    if (!containerRef.current) return

    const scene = new CausalScene3D(containerRef.current, (nodeId) => {
      setSelectedNodeId(nodeId)
    })
    sceneRef.current = scene

    // 监听连接状态变更
    const unConn = visualizerClient.onConnectionChange((connected) => {
      setIsConnected(connected)
      if (connected) {
        syncTopology()
      }
    })

    // 订阅微内核原生遥测流（带防抖批处理）
    const unsubscribe = visualizerClient.subscribe((event) => {
      enqueueLog(event)

      switch (event.type) {
        case 'info_sent': {
          const edgeKey = `${event.fromNodeId}->${event.toNodeId}`

          // 动态发现新边：若当前拓扑中尚无此光轨，动态记录并防抖触发重排
          if (!edgeSetRef.current.has(edgeKey)) {
            const newEdge: CausalEdge3D = {
              id: edgeKey,
              from: event.fromNodeId,
              to: event.toNodeId,
              color: '#38bdf8',
              active: true,
              lastSentTime: event.timestamp,
              lastInfoType: event.info.type,
            }
            edgesRef.current.push(newEdge)
            edgeSetRef.current.add(edgeKey)
            setEdges([...edgesRef.current])
            scheduleRelayout()
          }

          // 3D 视觉即时响应（由 Three.js 内部控频，不阻塞 React）
          const payloadSummary = event.info ? JSON.stringify(event.info).slice(0, 32) : undefined
          scene.triggerInfoTransmission(event.fromNodeId, event.toNodeId, event.info.type, payloadSummary)
          break
        }

        case 'change_start': {
          const node = nodesRef.current.find((n) => n.id === event.nodeId)
          if (node) {
            node.status = 'RUNNING'
            triggerThrottledNodeUpdate()
          }
          break
        }

        case 'change_end': {
          const node = nodesRef.current.find((n) => n.id === event.nodeId)
          if (node) {
            node.status = 'IDLE'
            triggerThrottledNodeUpdate()
          }
          break
        }

        case 'state_mutated': {
          const node = nodesRef.current.find((n) => n.id === event.nodeId)
          if (node) {
            node.version = event.version
            node.state = event.state
            triggerThrottledNodeUpdate()
          }
          break
        }

        case 'node_admitted': {
          syncTopology()
          break
        }

        case 'node_evicted': {
          syncTopology()
          break
        }

        default:
          break
      }
    })

    // 初次尝试拉取拓扑
    syncTopology()

    // 自动重试探活（如果初始节点数还是 0，每 2 秒静默探测一次）
    const retryInterval = setInterval(() => {
      if (nodesRef.current.length === 0) {
        syncTopology()
      }
    }, 2000)

    return () => {
      clearInterval(retryInterval)
      unConn()
      unsubscribe()
      if (logFlushRafRef.current) cancelAnimationFrame(logFlushRafRef.current)
      if (nodeUpdateTimerRef.current) clearTimeout(nodeUpdateTimerRef.current)
      if (layoutDebounceTimerRef.current) clearTimeout(layoutDebounceTimerRef.current)
      scene.dispose()
    }
  }, [enqueueLog, triggerThrottledNodeUpdate, scheduleRelayout, syncTopology])

  const handleSelectNode = (nodeId: string | null) => {
    setSelectedNodeId(nodeId)
    sceneRef.current?.setSelectedNode(nodeId)
  }

  const handleToggleAutoRotate = () => {
    const next = !autoRotate
    setAutoRotate(next)
    sceneRef.current?.setAutoRotate(next)
  }

  const handleResetCamera = () => {
    sceneRef.current?.resetCamera()
  }

  const handleFocusSelected = () => {
    if (selectedNodeId) {
      sceneRef.current?.focusNode(selectedNodeId)
    }
  }

  const handleClearLogs = () => {
    setLogs([])
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  const domainCount = nodes.filter((n) => n.role === 'domain').length
  const obsCount = nodes.filter((n) => n.role === 'observation').length
  const execCount = nodes.filter((n) => n.role === 'execution').length

  // 构建字符艺术因果流转树 (ASCII Causal Dependency Tree)
  const renderAsciiTree = () => {
    if (!selectedNode) return ''
    const upEdges = edges.filter((e) => e.to === selectedNode.id && !e.isVerticalStalk)
    const downEdges = edges.filter((e) => e.from === selectedNode.id && !e.isVerticalStalk)

    const roleLabel =
      selectedNode.role === 'observation'
        ? 'OBSERVATION WORLD'
        : selectedNode.role === 'execution'
        ? 'EXECUTION WORLD'
        : 'PURE DOMAIN CORE'

    let lines: string[] = []
    lines.push('╔═══════════════════════════════════════════════════════╗')
    lines.push('║        C A U S A L   F L O W   P R O B E              ║')
    lines.push('╚═══════════════════════════════════════════════════════╝')
    lines.push(`┌── [▲ UPSTREAM CAUSAL ORIGIN (入流前序: ${upEdges.length})]`)
    if (upEdges.length === 0) {
      lines.push('│   └─ (无前序入流 · 初始根源节点)')
    } else {
      upEdges.forEach((e, idx) => {
        const isLast = idx === upEdges.length - 1
        const branch = isLast ? '└──' : '├──'
        const info = e.lastInfoType || 'Info'
        lines.push(`│   ${branch} [${e.from}] ──(${info})─►`)
      })
    }

    lines.push('│')
    lines.push(`◆── [TARGET: ${selectedNode.id}] [${roleLabel}]`)
    lines.push('│')

    lines.push(`└── [▼ DOWNSTREAM CAUSAL DISPATCH (派发出流: ${downEdges.length})]`)
    if (downEdges.length === 0) {
      lines.push('    └── (无后序派发 · 终端汇聚节点)')
    } else {
      downEdges.forEach((e, idx) => {
        const isLast = idx === downEdges.length - 1
        const branch = isLast ? '└──' : '├──'
        const info = e.lastInfoType || 'Info'
        lines.push(`    ${branch} ──(${info})─► [${e.to}]`)
      })
    }

    return lines.join('\n')
  }

  return (
    <div className="visualizer-root">
      {/* 3D WebGL 画布 */}
      <div ref={containerRef} className="canvas-container" />

      {/* 像素海岛 HUD 顶部全息状态条 */}
      <header className="top-bar">
        <div className="title-group">
          <span className="logo-badge">🏝️</span>
          <div>
            <div className="brand-badge">NAUTICAL ARCHIPELAGO · EXPEDITION HUD</div>
            <h1>GSDK 3D 像素海岛因果全息观测看板</h1>
            <div className="subtitle">纯图无关 · 像素群岛洋流 · 观察灯塔 / 物理渔港 / 领域聚落</div>
          </div>
          {isConnected ? (
            <div className="kernel-badge live">
              <span className="live-dot" />
              [KERNEL: RUST_NATIVE_LIVE]
            </div>
          ) : (
            <div className="kernel-badge waiting">
              [KERNEL: WAITING_CONNECTION]
            </div>
          )}
        </div>

        <div className="stats-group">
          <div className="stat-item">
            <span className="label">三层活跃海岛</span>
            <div className="tier-counters">
              <span className="tier-pill domain" title="纯领域聚落海岛">◈ {domainCount}</span>
              <span className="tier-pill obs" title="观察悬崖灯塔岛 (感知)">▲ {obsCount}</span>
              <span className="tier-pill exec" title="执行垂钓渔港岛 (动作)">▼ {execCount}</span>
            </div>
          </div>
          <div className="stat-item">
            <span className="label">航运航线水道</span>
            <span className="value">{edges.filter((e) => !e.isVerticalStalk).length} 条</span>
          </div>
          <div className="stat-item">
            <span className="label">近岸水陆水道</span>
            <span className="value">{edges.filter((e) => e.isVerticalStalk).length} 根</span>
          </div>
          <div className="stat-item">
            <span className="label">群岛海域环礁</span>
            <span className="value">{communities.length} POD</span>
          </div>
          <div className="stat-item">
            <span className="label">遥测事件帧</span>
            <span className="value">{logs.length}</span>
          </div>
          {revision > 0 && (
            <div className="stat-item">
              <span className="label">微内核版本</span>
              <span className="value">#r{revision}</span>
            </div>
          )}
        </div>
      </header>

      {/* 极客风格底部控制坞 */}
      <footer className="bottom-dock">
        <button className="btn-ctrl" onClick={handleResetCamera} title="重置摄像机位置">
          🎯 [0x00:复位]
        </button>
        <button
          className="btn-ctrl"
          style={{ borderColor: autoRotate ? 'var(--vis-accent)' : undefined }}
          onClick={handleToggleAutoRotate}
          title="开启/停止 3D 空间缓慢自转"
        >
          {autoRotate ? '⏸️ [自转:开]' : '🔄 [自转:关]'}
        </button>
        <button className="btn-ctrl" onClick={toggleLayoutMode} title="切换 3D 拓扑群落聚类与因果流水线布局">
          {layoutMode === 'community' ? '🪐 [排布:LPA社区]' : '🌊 [排布:因果流水线]'}
        </button>
        {selectedNodeId && (
          <button className="btn-ctrl active" onClick={handleFocusSelected} title="镜头推进聚焦到选中的节点">
            🔍 [聚焦:TARGET]
          </button>
        )}
        <div className="dock-divider" />
        <button className="btn-ctrl" onClick={syncTopology} title="重新从微内核拉取最新拓扑快照">
          🌌 [同步:TOPOLOGY]
        </button>
        <button className="btn-ctrl" onClick={handleClearLogs} title="清空历史事件流">
          🧹 [清屏:CLEAR]
        </button>
      </footer>

      {/* 左下角实时内核遥测日志（极客字符流） */}
      <aside className="event-feed">
        <div className="feed-header">
          <span>⚡ [TELEMETRY_STREAM::LIVE]</span>
          <span className="feed-status">● STREAMING</span>
        </div>
        <div className="feed-list">
          {logs.length === 0 ? (
            <div style={{ color: 'var(--vis-text-muted)', fontSize: 11, padding: 12, lineHeight: 1.5, fontFamily: 'monospace' }}>
              &gt; 观测器因果监听已就绪。<br />
              &gt; 当微内核发生 ctx.send 时，上下游管网将即时发光并激发光子飞渡。
            </div>
          ) : (
            logs.slice(0, 20).map((log, idx) => (
              <div key={idx} className={`feed-item ${log.type}`}>
                <div className="feed-type">[{log.type}]</div>
                <div className="feed-desc">
                  {log.type === 'info_sent' && `${log.fromNodeId} ──► ${log.toNodeId} (${log.info.type})`}
                  {log.type === 'state_mutated' && `${log.nodeId} State 变迁至 v${log.version}`}
                  {log.type === 'root_injected' && `根注入 ──► ${log.targetNodeId} (${log.info.type})`}
                  {log.type === 'change_start' && `调度开始: ${log.nodeId} (${log.info.type})`}
                  {log.type === 'change_end' && `调度收敛: ${log.nodeId} (${log.durationMs.toFixed(1)}ms)`}
                  {log.type === 'node_admitted' && `实体准入: ${log.nodeId}@Gen${log.generation}`}
                  {log.type === 'node_evicted' && `实体卸载: ${log.nodeId}`}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* 右侧海岛详情抽屉（航海字符艺术拓扑 + 像素生态探针） */}
      {selectedNode && (
        <section className="inspector-drawer">
          <div className="inspector-header">
            <div>
              <div className={`role-badge ${selectedNode.role}`}>
                {selectedNode.role === 'observation' && '▲ 观察海岛 [悬崖像素灯塔 · 360°巡夜扫海]'}
                {selectedNode.role === 'execution' && '▼ 执行海岛 [临水垂钓栈桥 · 草帽渔翁垂钓]'}
                {selectedNode.role === 'domain' && '◈ 领域海岛 [聚落中心小木屋 · 零 I/O 状态机]'}
              </div>
              <h2>{selectedNode.isHub ? `👑 ${selectedNode.name}` : selectedNode.name}</h2>
              <div className="node-subid">
                ISLAND ID: {selectedNode.id}
              </div>
            </div>
            <button className="close-btn" onClick={() => handleSelectNode(null)}>×</button>
          </div>

          <div className="node-meta-grid">
            <div className="meta-card">
              <div className="label">代次 (GEN)</div>
              <div className="val">{selectedNode.generation !== null ? `Gen ${selectedNode.generation}` : 'DROPPED'}</div>
            </div>
            <div className="meta-card">
              <div className="label">状态版本 / 岛民</div>
              <div className="val">v{selectedNode.version} (🚶 {Math.min(4, Math.max(1, Math.floor(Math.log2(Math.max(1, selectedNode.version) + 1))))}人)</div>
            </div>
            <div className="meta-card">
              <div className="label">角色定位</div>
              <div className="val" style={{ color: selectedNode.role === 'observation' ? '#00f0ff' : (selectedNode.role === 'execution' ? '#f59e0b' : '#38bdf8') }}>
                {selectedNode.role.toUpperCase()}
              </div>
            </div>
            <div className="meta-card">
              <div className="label">航运网络度数</div>
              <div className="val">
                ↓{selectedNode.inDegree || 0} 入港 │ ↑{selectedNode.outDegree || 0} 出海
              </div>
            </div>
            <div className="meta-card" style={{ gridColumn: 'span 2' }}>
              <div className="label">所属群岛 (LPA Archipelago)</div>
              <div className="val" style={{ fontSize: 12, color: selectedNode.color }}>
                🏝️ {selectedNode.communityName || '独立环礁'}
              </div>
            </div>
          </div>

          {/* 字符艺术海岛上下游航运拓扑链 */}
          <div className="ascii-tree-card">
            <div className="ascii-tree-header">
              <span>◈ 上下游因果航线拓扑</span>
              <span style={{ fontSize: 10, color: 'var(--vis-accent)' }}>[双向 BFS 溯源]</span>
            </div>
            <pre className="ascii-tree-content">{renderAsciiTree()}</pre>
          </div>

          <div className="state-viewer">
            <div className="state-viewer-header">
              <span>◈ 节点私有 State 投影（图无关生态映射）</span>
              <span style={{ fontSize: 10, color: '#38bdf8' }}>[生态要素: {Object.keys(selectedNode.state).length > 0 ? `${Object.keys(selectedNode.state).length} 组属性生成` : '原始荒野'}]</span>
            </div>
            <pre className="state-json">
              {Object.keys(selectedNode.state).length === 0
                ? '// 暂无私有状态字段 (荒野原生态)'
                : JSON.stringify(selectedNode.state, null, 2)}
            </pre>
          </div>
        </section>
      )}
    </div>
  )
}
