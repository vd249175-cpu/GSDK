import React, { useEffect, useRef, useState, useCallback } from 'react'
import { visualizerClient } from './visualizer-client'
import type { CausalCommunity3D, CausalEdge3D, CausalNode3D, CausalTelemetryEvent } from './types'
import { SwissModernist2DRenderer } from './renderers/swiss-2d/swiss-modernist-renderer'
import { SwissNodeDetailPanel } from './renderers/swiss-2d/SwissNodeDetailPanel'
import { inferNodeRole } from './renderers/swiss-2d/swiss-layout-engine'
import './visualizer.css'

/**
 * 2D 瑞士先锋主义因果观测仪 (Swiss Modernist Causal Visualizer)
 * 纯粹理性、极简功能主义、严苛网格、曼哈顿正交因果布线与高反差字重
 */
export function VisualizerApp() {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<SwissModernist2DRenderer | null>(null)

  const [nodes, setNodes] = useState<CausalNode3D[]>([])
  const [edges, setEdges] = useState<CausalEdge3D[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [isConnected, setIsConnected] = useState(visualizerClient.connected)

  // 内部维护活跃节点与边的映射，确保图无关动态发现
  const nodesRef = useRef<CausalNode3D[]>([])
  const edgesRef = useRef<CausalEdge3D[]>([])
  const edgeSetRef = useRef<Set<string>>(new Set())

  const nodeUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layoutDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 节流节点属性更新（版本、状态），最高 80ms 一次渲染刷新
  const triggerThrottledNodeUpdate = useCallback(() => {
    if (!nodeUpdateTimerRef.current) {
      nodeUpdateTimerRef.current = setTimeout(() => {
        nodeUpdateTimerRef.current = null
        setNodes([...nodesRef.current])
        rendererRef.current?.updateTopology(nodesRef.current, edgesRef.current)
      }, 80)
    }
  }, [])

  // 防抖拓扑重新排布（新边动态发现时），120ms 防抖
  const scheduleRelayout = useCallback(() => {
    if (layoutDebounceTimerRef.current) clearTimeout(layoutDebounceTimerRef.current)
    layoutDebounceTimerRef.current = setTimeout(() => {
      layoutDebounceTimerRef.current = null
      rendererRef.current?.updateTopology(nodesRef.current, edgesRef.current)
    }, 120)
  }, [])

  const syncTopology = useCallback(async () => {
    try {
      const snapshot = await visualizerClient.fetchLiveTopology()
      if (snapshot?.nodes && snapshot.nodes.length > 0) {
        setRevision(snapshot.revision)

        const rawEdges: CausalEdge3D[] = (snapshot.routes || []).map((r) => ({
          id: `${r.from}->${r.to}`,
          from: r.from,
          to: r.to,
          color: '#0a0a0a',
          active: true,
          lastSentTime: Date.now(),
          lastInfoType: r.infoType,
        }))

        // 保留运行时已发现的动态边
        for (const e of edgesRef.current) {
          if (!rawEdges.some((re) => re.from === e.from && re.to === e.to)) {
            rawEdges.push(e)
          }
        }

        const mappedNodes: CausalNode3D[] = snapshot.nodes.map((n) => {
          const role = inferNodeRole(n.nodeId)
          return {
            id: n.nodeId,
            name: n.nodeId,
            color: role === 'observation' ? '#002fa7' : role === 'execution' ? '#ff3300' : '#0a0a0a',
            position: [0, 0, 0],
            generation: n.generation ?? 0,
            version: n.version ?? 0,
            status: (n.status as any) || 'IDLE',
            state: n.state || {},
            role,
          }
        })

        nodesRef.current = mappedNodes
        edgesRef.current = rawEdges
        edgeSetRef.current = new Set(rawEdges.map((e) => `${e.from}->${e.to}`))

        setNodes(mappedNodes)
        setEdges(rawEdges)
        rendererRef.current?.updateTopology(mappedNodes, rawEdges)
      }
    } catch (err) {
      console.warn('[VisualizerApp] Sync live topology fallback:', err)
    }
  }, [])

  // 挂载 2D 瑞士先锋主义视口渲染引擎
  useEffect(() => {
    if (!containerRef.current) return

    const renderer = new SwissModernist2DRenderer({
      onNodeSelect: (nodeId) => {
        setSelectedNodeId(nodeId)
      },
    })

    renderer.mount(containerRef.current)
    rendererRef.current = renderer

    // 监听微内核连接
    const unConn = visualizerClient.onConnectionChange((connected) => {
      setIsConnected(connected)
      if (connected) {
        syncTopology()
      }
    })

    // 订阅微内核原生遥测流（带防抖批处理与范式无关分发）
    const unsubscribe = visualizerClient.subscribe((event) => {
      switch (event.type) {
        case 'info_sent': {
          const edgeKey = `${event.fromNodeId}->${event.toNodeId}`

          if (!edgeSetRef.current.has(edgeKey)) {
            const newEdge: CausalEdge3D = {
              id: edgeKey,
              from: event.fromNodeId,
              to: event.toNodeId,
              color: '#0a0a0a',
              active: true,
              lastSentTime: event.timestamp,
              lastInfoType: event.info.type,
            }
            edgesRef.current.push(newEdge)
            edgeSetRef.current.add(edgeKey)
            setEdges([...edgesRef.current])
            scheduleRelayout()
          }

          const payloadSummary = event.info ? JSON.stringify(event.info).slice(0, 32) : undefined
          rendererRef.current?.triggerInfoTransmission(
            event.fromNodeId,
            event.toNodeId,
            event.info.type,
            payloadSummary,
          )
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
            rendererRef.current?.triggerNodeImpact?.(event.nodeId)
          }
          break
        }

        case 'node_admitted':
        case 'node_evicted': {
          syncTopology()
          break
        }

        default:
          break
      }
    })

    syncTopology()

    const retryInterval = setInterval(() => {
      if (nodesRef.current.length === 0) {
        syncTopology()
      }
    }, 2000)

    return () => {
      clearInterval(retryInterval)
      unConn()
      unsubscribe()
      if (nodeUpdateTimerRef.current) clearTimeout(nodeUpdateTimerRef.current)
      if (layoutDebounceTimerRef.current) clearTimeout(layoutDebounceTimerRef.current)
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [triggerThrottledNodeUpdate, scheduleRelayout, syncTopology])

  // ESC 键快捷取消选中
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedNodeId(null)
        rendererRef.current?.setSelectedNode(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)

  return (
    <div className="visualizer-root swiss-2d">
      {/* 视口渲染容器 (挂载 2D 瑞士先锋看板) */}
      <div ref={containerRef} className="canvas-container" />

      {/* 左上角瑞士先锋极简状态标识 (Bauhaus Minimalist HUD) */}
      <header className="swiss-top-hud" aria-label="系统状态总览">
        <div className="swiss-hud-brand">
          <span className="swiss-hud-square" />
          <span className="swiss-hud-title">SWISS CAUSAL BOARD</span>
          <span className="swiss-hud-sub">// 先锋因果看板</span>
        </div>
        <div className="swiss-hud-meta">
          <span className={`swiss-hud-status ${isConnected ? 'live' : 'offline'}`}>
            <span className="status-dot" />
            {isConnected ? 'LIVE' : 'OFFLINE'}
          </span>
          <span className="swiss-hud-divider">/</span>
          <span className="swiss-hud-item">REV.{revision}</span>
          <span className="swiss-hud-divider">/</span>
          <span className="swiss-hud-item">NODES {nodes.length}</span>
          <span className="swiss-hud-divider">/</span>
          <span className="swiss-hud-item">ROUTES {edges.length}</span>
        </div>
      </header>

      {/* 2D 瑞士看板专属详细信息规格详单 */}
      {selectedNode && (
        <SwissNodeDetailPanel
          node={selectedNode}
          allNodes={nodes}
          edges={edges}
          onClose={() => {
            setSelectedNodeId(null)
            rendererRef.current?.setSelectedNode(null)
          }}
          onSelectNode={(nodeId) => {
            setSelectedNodeId(nodeId)
            rendererRef.current?.setSelectedNode(nodeId)
          }}
        />
      )}
    </div>
  )
}
