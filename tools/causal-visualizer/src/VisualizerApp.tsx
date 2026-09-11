import React, { useEffect, useRef, useState } from 'react'
import { CausalScene3D } from './causal-scene'
import { computeGraphAgnosticLayout } from './layout-engine'
import { visualizerClient } from './visualizer-client'
import type { CausalEdge3D, CausalNode3D, CausalTelemetryEvent } from './types'
import './visualizer.css'

export function VisualizerApp() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CausalScene3D | null>(null)

  const [nodes, setNodes] = useState<CausalNode3D[]>([])
  const [edges, setEdges] = useState<CausalEdge3D[]>([])
  const [logs, setLogs] = useState<CausalTelemetryEvent[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [autoRotate, setAutoRotate] = useState(false)
  const [revision, setRevision] = useState(0)

  // 内部维护活跃节点与边的映射，确保图无关动态发现
  const nodesRef = useRef<CausalNode3D[]>([])
  const edgesRef = useRef<CausalEdge3D[]>([])
  const edgeSetRef = useRef<Set<string>>(new Set())

  const syncTopology = async () => {
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

        const layout = computeGraphAgnosticLayout(snapshot.nodes, rawEdges)
        nodesRef.current = layout.nodes
        edgesRef.current = layout.edges
        edgeSetRef.current = new Set(layout.edges.map((e) => `${e.from}->${e.to}`))

        setNodes([...layout.nodes])
        setEdges([...layout.edges])
        sceneRef.current?.updateTopology(layout.nodes, layout.edges)
      }
    } catch (err) {
      console.warn('[VisualizerApp] Sync live topology fallback:', err)
    }
  }

  useEffect(() => {
    if (!containerRef.current) return

    const scene = new CausalScene3D(containerRef.current, (nodeId) => {
      setSelectedNodeId(nodeId)
    })
    sceneRef.current = scene

    // 订阅微内核原生遥测流（纯被动监听，图无关）
    const unsubscribe = visualizerClient.subscribe((event) => {
      setLogs((prev) => [event, ...prev.slice(0, 99)])

      switch (event.type) {
        case 'info_sent': {
          const edgeKey = `${event.fromNodeId}->${event.toNodeId}`

          // 动态发现新边：若当前拓扑中尚无此光轨，立刻在 3D 空间动态建立！
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
            scene.updateTopology(nodesRef.current, edgesRef.current)
          }

          // 触发高能发光与光子飞驰
          const payloadSummary = event.info ? JSON.stringify(event.info).slice(0, 32) : undefined
          scene.triggerInfoTransmission(event.fromNodeId, event.toNodeId, event.info.type, payloadSummary)
          break
        }

        case 'change_start': {
          const node = nodesRef.current.find((n) => n.id === event.nodeId)
          if (node) {
            node.status = 'RUNNING'
            setNodes([...nodesRef.current])
            scene.updateTopology(nodesRef.current, edgesRef.current)
          }
          break
        }

        case 'change_end': {
          const node = nodesRef.current.find((n) => n.id === event.nodeId)
          if (node) {
            node.status = 'IDLE'
            setNodes([...nodesRef.current])
            scene.updateTopology(nodesRef.current, edgesRef.current)
          }
          break
        }

        case 'state_mutated': {
          const node = nodesRef.current.find((n) => n.id === event.nodeId)
          if (node) {
            node.version = event.version
            node.state = event.state
            setNodes([...nodesRef.current])
            scene.updateTopology(nodesRef.current, edgesRef.current)
          }
          break
        }

        case 'node_admitted': {
          let node = nodesRef.current.find((n) => n.id === event.nodeId)
          if (!node) {
            // 动态准入新节点：触发全图自适应重排
            syncTopology()
          } else {
            node.generation = event.generation
            node.status = 'IDLE'
            setNodes([...nodesRef.current])
            scene.updateTopology(nodesRef.current, edgesRef.current)
          }
          break
        }

        case 'node_evicted': {
          const node = nodesRef.current.find((n) => n.id === event.nodeId)
          if (node) {
            node.generation = null
            node.status = 'DROPPED'
            setNodes([...nodesRef.current])
            scene.updateTopology(nodesRef.current, edgesRef.current)
          }
          break
        }

        default:
          break
      }
    })

    // 初次拉取内核实时拓扑
    syncTopology()

    return () => {
      unsubscribe()
      scene.dispose()
    }
  }, [])

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
            <div className="subtitle">纯图无关 · 调度内核数字孪生</div>
          </div>
          <span className="kernel-tag">NativeRuleSpace Live</span>
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

      {/* 右侧节点详情抽屉（展示被选中节点的真实状态投影） */}
      {selectedNode && (
        <section className="inspector-drawer">
          <div className="inspector-header">
            <div>
              <h2>{selectedNode.name}</h2>
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
              <div className="label">调度状态</div>
              <div className="val" style={{ color: selectedNode.status === 'RUNNING' ? '#22c55e' : undefined }}>
                {selectedNode.status}
              </div>
            </div>
            <div className="meta-card">
              <div className="label">因果层级 (Tier)</div>
              <div className="val">{selectedNode.tier !== undefined ? `Level ${selectedNode.tier}` : '-'}</div>
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
