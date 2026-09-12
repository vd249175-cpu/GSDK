import React, { useEffect, useRef, useState, useCallback } from 'react'
import { computeGraphAgnosticLayout, type LayoutMode } from './layout-engine'
import { visualizerClient } from './visualizer-client'
import type { CausalCommunity3D, CausalEdge3D, CausalNode3D, CausalTelemetryEvent, InspectItemData } from './types'
import type { IVisualizerRenderer } from './renderers/renderer-interface'
import { Archipelago3DRenderer } from './renderers/archipelago-3d-renderer'
import { TopNavigationBar } from './components/TopNavigationBar'
import { IslandViewBanner } from './components/IslandViewBanner'
import { IslandItemsBar } from './components/IslandItemsBar'
import { ItemInspectCard } from './components/ItemInspectCard'
import { BottomControlsDock } from './components/BottomControlsDock'
import { TelemetryFeed } from './components/TelemetryFeed'
import './visualizer.css'

export function VisualizerApp() {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<IVisualizerRenderer | null>(null)

  const [nodes, setNodes] = useState<CausalNode3D[]>([])
  const [edges, setEdges] = useState<CausalEdge3D[]>([])
  const [communities, setCommunities] = useState<CausalCommunity3D[]>([])
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('community')
  const [logs, setLogs] = useState<CausalTelemetryEvent[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [inspectedItem, setInspectedItem] = useState<InspectItemData | null>(null)
  const [autoRotate, setAutoRotate] = useState(false)
  const [revision, setRevision] = useState(0)
  const [isConnected, setIsConnected] = useState(visualizerClient.connected)

  // 内部维护活跃节点与边的映射，确保图无关动态发现
  const nodesRef = useRef<CausalNode3D[]>([])
  const edgesRef = useRef<CausalEdge3D[]>([])
  const communitiesRef = useRef<CausalCommunity3D[]>([])
  const edgeSetRef = useRef<Set<string>>(new Set())
  const layoutModeRef = useRef<LayoutMode>('community')

  // 保持同步
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

  // 节流节点属性更新（版本、状态），最高 80ms 一次渲染刷新
  const triggerThrottledNodeUpdate = useCallback(() => {
    if (!nodeUpdateTimerRef.current) {
      nodeUpdateTimerRef.current = setTimeout(() => {
        nodeUpdateTimerRef.current = null
        setNodes([...nodesRef.current])
        rendererRef.current?.updateTopology(nodesRef.current, edgesRef.current, communitiesRef.current)
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
      rendererRef.current?.updateTopology(layout.nodes, layout.edges, layout.communities)
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
        rendererRef.current?.updateTopology(layout.nodes, layout.edges, layout.communities)

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
    rendererRef.current?.updateTopology(layout.nodes, layout.edges, layout.communities)
  }

  useEffect(() => {
    if (!containerRef.current) return

    // 挂载 3D 像素海岛呈现范式
    const renderer = new Archipelago3DRenderer({
      onNodeSelect: (nodeId) => {
        setSelectedNodeId(nodeId)
        if (!nodeId) setInspectedItem(null)
      },
      onItemInspect: (item) => {
        setInspectedItem(item)
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

    // 订阅微内核原生遥测流（带防抖批处理）
    const unsubscribe = visualizerClient.subscribe((event) => {
      enqueueLog(event)

      switch (event.type) {
        case 'info_sent': {
          const edgeKey = `${event.fromNodeId}->${event.toNodeId}`

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

          const payloadSummary = event.info ? JSON.stringify(event.info).slice(0, 32) : undefined
          renderer.triggerInfoTransmission(event.fromNodeId, event.toNodeId, event.info.type, payloadSummary)
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
            renderer.triggerNodeImpact?.(event.nodeId)
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
      if (logFlushRafRef.current) cancelAnimationFrame(logFlushRafRef.current)
      if (nodeUpdateTimerRef.current) clearTimeout(nodeUpdateTimerRef.current)
      if (layoutDebounceTimerRef.current) clearTimeout(layoutDebounceTimerRef.current)
      renderer.dispose()
      rendererRef.current = null
    }
  }, [enqueueLog, triggerThrottledNodeUpdate, scheduleRelayout, syncTopology])

  const handleToggleAutoRotate = () => {
    const next = !autoRotate
    setAutoRotate(next)
    rendererRef.current?.setAutoRotate?.(next)
  }

  const handleResetCamera = () => {
    setSelectedNodeId(null)
    setInspectedItem(null)
    rendererRef.current?.returnToOverview?.()
  }

  const handleFocusSelected = () => {
    if (selectedNodeId) {
      rendererRef.current?.focusNode?.(selectedNodeId)
    }
  }

  const handleClearLogs = () => {
    setLogs([])
  }

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  const selectedAssembly = selectedNodeId ? rendererRef.current?.getNodeAssembly?.(selectedNodeId) : undefined
  const islandItems = selectedAssembly?.inspectableItems || []

  const domainCount = nodes.filter((n) => n.role === 'domain').length
  const obsCount = nodes.filter((n) => n.role === 'observation').length
  const execCount = nodes.filter((n) => n.role === 'execution').length
  const routeCount = edges.filter((e) => !e.isVerticalStalk).length

  return (
    <div className="visualizer-root">
      {/* 3D 像素海岛生态 WebGL 画布 */}
      <div ref={containerRef} className="canvas-container" />

      {/* 阳光海岛顶部航海仪表盘 */}
      <TopNavigationBar
        isConnected={isConnected}
        domainCount={domainCount}
        obsCount={obsCount}
        execCount={execCount}
        routeCount={routeCount}
        communityCount={communities.length}
        logCount={logs.length}
        revision={revision}
      />

      {/* 小岛微观视角标牌与生态属性条 */}
      {selectedNode && (
        <>
          <IslandViewBanner
            node={selectedNode}
            onBackOverview={handleResetCamera}
          />

          <IslandItemsBar
            items={islandItems}
            selectedItem={inspectedItem}
            onSelectItem={(item) => setInspectedItem(item)}
          />
        </>
      )}

      {/* 状态字段卡片 */}
      {inspectedItem && (
        <ItemInspectCard
          item={inspectedItem}
          onClose={() => setInspectedItem(null)}
        />
      )}

      {/* 底部控制坞 */}
      <BottomControlsDock
        selectedNodeId={selectedNodeId}
        autoRotate={autoRotate}
        layoutMode={layoutMode}
        onResetCamera={handleResetCamera}
        onToggleAutoRotate={handleToggleAutoRotate}
        onToggleLayoutMode={toggleLayoutMode}
        onFocusSelected={handleFocusSelected}
        onSyncTopology={syncTopology}
        onClearLogs={handleClearLogs}
      />

      {/* 航海因果日志 */}
      <TelemetryFeed logs={logs} />
    </div>
  )
}
