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
          let node = nodesRef.current.find((n) => n.id === event.nodeId)
          if (!node) {
            syncTopology()
          } else {
            node.generation = event.generation
            node.status = 'IDLE'
            triggerThrottledNodeUpdate()
          }
          break
        }

        case 'node_evicted': {
          const node = nodesRef.current.find((n) => n.id === event.nodeId)
          if (node) {
            node.generation = null
            node.status = 'DROPPED'
            triggerThrottledNodeUpdate()
          }
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

  return (
    <div className="visualizer-root">
      {/* 3D WebGL 画布 */}
      <div ref={containerRef} className="canvas-container" />

      {/* 顶部全息状态条 */}
      <header className="top-bar">
        <div className="title-group">
          <span className="logo-badge">🪐</span>
          <div>
            <h1>GSDK 3D 因果数据流全息观测器</h1>
            <div className="subtitle">纯图无关 · LPA 社区聚类 · 调度内核数字孪生</div>
          </div>
          {isConnected ? (
            <span className="kernel-tag">NativeRuleSpace Live (127.0.0.1:51888)</span>
          ) : (
            <span
              className="kernel-tag"
              style={{
                borderColor: '#f59e0b',
                color: '#f59e0b',
                background: 'rgba(245, 158, 11, 0.1)',
              }}
            >
              等待桌面端连接 (127.0.0.1:51888)
            </span>
          )}
        </div>

        <div className="stats-group">
          <div className="stat-item">
            <span className="label">微内核活跃节点</span>
            <span className="value">{nodes.filter((n) => n.generation !== null).length} / {nodes.length}</span>
          </div>
          <div className="stat-item">
            <span className="label">动态因果光轨</span>
            <span className="value">{edges.length} 条</span>
          </div>
          <div className="stat-item">
            <span className="label">LPA 聚类群落</span>
            <span className="value">{communities.length} 个</span>
          </div>
          <div className="stat-item">
            <span className="label">遥测事件帧</span>
            <span className="value">{logs.length}</span>
          </div>
          {revision > 0 && (
            <div className="stat-item">
              <span className="label">内核版本</span>
              <span className="value">r{revision}</span>
            </div>
          )}
        </div>
      </header>

      {/* 底部纯观测控制坞（纯视角与流向控制，零业务按钮） */}
      <footer className="bottom-dock">
        <button className="btn-ctrl" onClick={handleResetCamera} title="重置摄像机位置">
          🎯 复位视角
        </button>
        <button
          className="btn-ctrl"
          style={{ borderColor: autoRotate ? 'var(--vis-accent)' : undefined }}
          onClick={handleToggleAutoRotate}
          title="开启/停止 3D 空间缓慢自转"
        >
          {autoRotate ? '⏸️ 暂停自转' : '🔄 空间自转'}
        </button>
        <button className="btn-ctrl" onClick={toggleLayoutMode} title="切换 3D 拓扑群落聚类与因果流水线布局">
          {layoutMode === 'community' ? '🪐 布局: LPA 群落聚类' : '🌊 布局: 因果流水线'}
        </button>
        {selectedNodeId && (
          <button className="btn-ctrl" onClick={handleFocusSelected} title="镜头推进聚焦到选中的节点">
            🔍 聚焦节点
          </button>
        )}
        <div className="dock-divider" />
        <button className="btn-ctrl" onClick={syncTopology} title="重新从微内核拉取最新拓扑快照">
          🌌 同步拓扑
        </button>
        <button className="btn-ctrl" onClick={handleClearLogs} title="清空历史事件流">
          🧹 清空流
        </button>
      </footer>

      {/* 左下角实时内核遥测日志（真实数据流动时高亮滚动） */}
      <aside className="event-feed">
        <div className="feed-header">
          <span>⚡ 微内核实时遥测流</span>
          <span style={{ fontSize: 10, color: 'var(--vis-accent)' }}>● 实时监听中</span>
        </div>
        <div className="feed-list">
          {logs.length === 0 ? (
            <div style={{ color: 'var(--vis-text-muted)', fontSize: 11, padding: 12, lineHeight: 1.5 }}>
              观测器已就绪。<br />
              当微内核发生 ctx.send、状态变更或调度时，光轨将即时发光并在此呈现。
            </div>
          ) : (
            logs.slice(0, 20).map((log, idx) => (
              <div key={idx} className={`feed-item ${log.type}`}>
                <div className="feed-type">{log.type}</div>
                <div className="feed-desc">
                  {log.type === 'info_sent' && `${log.fromNodeId} ➔ ${log.toNodeId} (${log.info.type})`}
                  {log.type === 'state_mutated' && `${log.nodeId} State 变迁至 v${log.version}`}
                  {log.type === 'root_injected' && `根因果注入 ➔ ${log.targetNodeId} (${log.info.type})`}
                  {log.type === 'change_start' && `调度单飞: ${log.nodeId} (${log.info.type})`}
                  {log.type === 'change_end' && `完成调度: ${log.nodeId} (${log.durationMs.toFixed(1)}ms)`}
                  {log.type === 'node_admitted' && `节点准入: ${log.nodeId}@Gen${log.generation}`}
                  {log.type === 'node_evicted' && `节点卸载: ${log.nodeId}`}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* 右侧节点详情抽屉（展示被选中节点的真实状态投影与群落图论指标） */}
      {selectedNode && (
        <section className="inspector-drawer">
          <div className="inspector-header">
            <div>
              <h2>{selectedNode.isHub ? `👑 ${selectedNode.name}` : selectedNode.name}</h2>
              <div style={{ fontSize: 11, color: 'var(--vis-text-muted)', marginTop: 2 }}>
                {selectedNode.id}
              </div>
            </div>
            <button className="close-btn" onClick={() => setSelectedNodeId(null)}>×</button>
          </div>

          <div className="node-meta-grid">
            <div className="meta-card">
              <div className="label">代次 (Gen)</div>
              <div className="val">{selectedNode.generation !== null ? `Gen ${selectedNode.generation}` : '已卸载'}</div>
            </div>
            <div className="meta-card">
              <div className="label">版本 (Ver)</div>
              <div className="val">v{selectedNode.version}</div>
            </div>
            <div className="meta-card">
              <div className="label">群落角色</div>
              <div className="val" style={{ color: selectedNode.isHub ? '#f59e0b' : '#38bdf8' }}>
                {selectedNode.isHub ? '👑 核心中枢' : '普通节点'}
              </div>
            </div>
            <div className="meta-card">
              <div className="label">网络度数</div>
              <div className="val">
                ↓{selectedNode.inDegree || 0} ↑{selectedNode.outDegree || 0}
              </div>
            </div>
            <div className="meta-card" style={{ gridColumn: 'span 2' }}>
              <div className="label">LPA 所属群落</div>
              <div className="val" style={{ fontSize: 13, color: selectedNode.color }}>
                {selectedNode.communityName || '未归类'}
              </div>
            </div>
          </div>

          <div className="state-viewer">
            <div className="state-viewer-header">私有 State 投影 (只读观察)</div>
            <pre className="state-json">
              {Object.keys(selectedNode.state).length === 0
                ? '// 暂无状态字段'
                : JSON.stringify(selectedNode.state, null, 2)}
            </pre>
          </div>
        </section>
      )}
    </div>
  )
}
