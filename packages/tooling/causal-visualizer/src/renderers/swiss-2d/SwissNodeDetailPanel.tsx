import React, { useState } from 'react'
import type { CausalEdge3D, CausalNode3D } from '../../types'

export interface SwissNodeDetailPanelProps {
  node: CausalNode3D
  allNodes: CausalNode3D[]
  edges: CausalEdge3D[]
  onClose: () => void
  onSelectNode: (nodeId: string) => void
}

export const SwissNodeDetailPanel: React.FC<SwissNodeDetailPanelProps> = ({
  node,
  allNodes,
  edges,
  onClose,
  onSelectNode,
}) => {
  const [copiedState, setCopiedState] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  // 1. 查找所有流入上游边与节点
  const inEdges = edges.filter((e) => e.to === node.id)
  const upstreamLinks = inEdges.map((e) => {
    const fromNode = allNodes.find((n) => n.id === e.from)
    return {
      edgeId: e.id,
      fromId: e.from,
      fromName: fromNode?.name || e.from,
      fromRole: fromNode?.role || 'domain',
      infoType: e.lastInfoType || 'Info',
    }
  })

  // 2. 查找所有流出下游边与节点
  const outEdges = edges.filter((e) => e.from === node.id)
  const downstreamLinks = outEdges.map((e) => {
    const toNode = allNodes.find((n) => n.id === e.to)
    return {
      edgeId: e.id,
      toId: e.to,
      toName: toNode?.name || e.to,
      toRole: toNode?.role || 'domain',
      infoType: e.lastInfoType || 'Info',
    }
  })

  const roleTier = node.role === 'observation' ? '01' : node.role === 'domain' ? '02' : '03'
  const roleTitle =
    node.role === 'observation'
      ? '▲ OBSERVATION // 外部感知'
      : node.role === 'execution'
        ? '▼ EXECUTION // 物理动作'
        : '◈ DOMAIN // 领域内核'

  const stateEntries = Object.entries(node.state || {})
  const isRunning = node.status === 'RUNNING'

  const handleCopyState = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(node.state || {}, null, 2))
      setCopiedState(true)
      setTimeout(() => setCopiedState(false), 1600)
    } catch {
      // 降级复制
    }
  }

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(node.id)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 1600)
    } catch {
      // 降级复制
    }
  }

  return (
    <aside className="swiss-detail-panel" aria-label="节点详细信息规格表">
      {/* 顶部标尺与元数据 Header */}
      <div className="swiss-panel-header">
        <div className="swiss-panel-top-bar">
          <span className="swiss-spec-index">SPECIFICATION SHEET // {roleTier}</span>
          <button className="swiss-panel-close-btn" onClick={onClose} title="关闭规格表 (ESC)">
            [ × CLOSE ]
          </button>
        </div>

        <div className="swiss-panel-title-wrap">
          <div className="swiss-panel-name-row">
            <span className={`swiss-role-pill ${node.role}`}>{roleTitle}</span>
            <span className="swiss-gen-tag">GEN.0{node.generation ?? 0}</span>
          </div>
          <h2 className="swiss-panel-node-name" title={node.name || node.id}>
            {node.name || node.id}
          </h2>
          <div className="swiss-panel-node-id-row">
            <span className="swiss-id-label">NODE_ID:</span>
            <code className="swiss-id-code">{node.id}</code>
            <button className="swiss-id-copy-btn" onClick={handleCopyId}>
              {copiedId ? 'COPIED ✓' : 'COPY'}
            </button>
          </div>
        </div>

        <div className="swiss-panel-stats-grid">
          <div className="swiss-stat-cell">
            <span className="swiss-stat-key">VERSION</span>
            <span className="swiss-stat-val val-ver">v{node.version}</span>
          </div>
          <div className="swiss-stat-cell">
            <span className="swiss-stat-key">STATUS</span>
            <span className={`swiss-stat-val val-status ${isRunning ? 'active' : 'idle'}`}>
              <span className="swiss-status-indicator" />
              {isRunning ? 'ACTIVE' : 'IDLE'}
            </span>
          </div>
          <div className="swiss-stat-cell">
            <span className="swiss-stat-key">DEGREE</span>
            <span className="swiss-stat-val val-degree">
              IN:{node.inDegree || inEdges.length} / OUT:{node.outDegree || outEdges.length}
            </span>
          </div>
        </div>
      </div>

      {/* 滚动内容区域 */}
      <div className="swiss-panel-body">
        {/* 因果链路穿梭 (Causal Trace Matrix) */}
        <section className="swiss-panel-section">
          <div className="swiss-section-title">
            <span>CAUSAL INFLOW // 上游因果输入</span>
            <span className="swiss-count-badge">{upstreamLinks.length}</span>
          </div>
          {upstreamLinks.length === 0 ? (
            <div className="swiss-empty-hint">零上游依赖 · 物理感知源头或独立节点</div>
          ) : (
            <div className="swiss-causal-links-list">
              {upstreamLinks.map((link) => (
                <div
                  key={link.edgeId}
                  className="swiss-causal-link-item upstream"
                  onClick={() => onSelectNode(link.fromId)}
                  title={`穿梭聚焦至上游节点 ${link.fromName}`}
                >
                  <div className="swiss-link-left">
                    <span className="swiss-link-arrow">←</span>
                    <span className="swiss-link-name">{link.fromName}</span>
                  </div>
                  <span className="swiss-link-info-type">{link.infoType}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="swiss-panel-section">
          <div className="swiss-section-title">
            <span>CAUSAL OUTFLOW // 下游因果输出</span>
            <span className="swiss-count-badge">{downstreamLinks.length}</span>
          </div>
          {downstreamLinks.length === 0 ? (
            <div className="swiss-empty-hint">零下游分发 · 因果链末端或孤立节点</div>
          ) : (
            <div className="swiss-causal-links-list">
              {downstreamLinks.map((link) => (
                <div
                  key={link.edgeId}
                  className="swiss-causal-link-item downstream"
                  onClick={() => onSelectNode(link.toId)}
                  title={`穿梭聚焦至下游节点 ${link.toName}`}
                >
                  <div className="swiss-link-left">
                    <span className="swiss-link-arrow">→</span>
                    <span className="swiss-link-name">{link.toName}</span>
                  </div>
                  <span className="swiss-link-info-type">{link.infoType}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 全量 State 字典规约 */}
        <section className="swiss-panel-section">
          <div className="swiss-section-title">
            <span>STATE DICTIONARY // 节点状态字典</span>
            <button className="swiss-copy-state-btn" onClick={handleCopyState}>
              {copiedState ? 'COPIED ✓' : '[ 📋 复制完整 STATE ]'}
            </button>
          </div>

          {stateEntries.length === 0 ? (
            <div className="swiss-empty-hint">该节点当前无私有状态数据 (EMPTY STATE)</div>
          ) : (
            <div className="swiss-state-table">
              {stateEntries.map(([key, val]) => {
                const valType = typeof val
                const isBool = valType === 'boolean'
                const isObj = valType === 'object' && val !== null

                return (
                  <div key={key} className="swiss-state-row">
                    <div className="swiss-state-key-col">
                      <span className="swiss-state-key-name">{key}</span>
                      <span className="swiss-state-key-type">{valType}</span>
                    </div>
                    <div className="swiss-state-val-col">
                      {isBool ? (
                        <span className={`swiss-bool-badge ${val ? 'true' : 'false'}`}>
                          {val ? 'TRUE' : 'FALSE'}
                        </span>
                      ) : isObj ? (
                        <pre className="swiss-json-block">{JSON.stringify(val, null, 2)}</pre>
                      ) : (
                        <span className="swiss-val-text">{String(val)}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* 微内核架构合规说明 (Architecture Rule Compliance) */}
        <section className="swiss-panel-section compliance-section">
          <div className="swiss-section-title">
            <span>ARCHITECTURE SPEC // 微内核合规契约</span>
          </div>
          <div className="swiss-compliance-box">
            {node.role === 'observation' && (
              <p>
                <b>【观察类节点规约】</b>
                物理事件感知与系统回调监听，感知事实封装为 Observation Info 并通过 <code>ctx.send</code> 流通，严格零主动写操作。
              </p>
            )}
            {node.role === 'domain' && (
              <p>
                <b>【纯领域节点规约】</b>
                零系统 API 与零外部 I/O。私有状态只能由 Owner Node 在 <code>change ctx</code> 中自发变迁，确保确定性可重演。
              </p>
            )}
            {node.role === 'execution' && (
              <p>
                <b>【执行类节点规约】</b>
                主动下发物理动作并获取 handle，物理动作严格经注入的 <code>EffectAdapter</code> 执行，任务下发即刻结算 change。
              </p>
            )}
          </div>
        </section>
      </div>

      {/* 底部功能栏 */}
      <div className="swiss-panel-footer">
        <span className="swiss-panel-checksum">HASH: {Math.abs(node.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)).toString(16).toUpperCase()}</span>
        <button className="swiss-footer-close-btn" onClick={onClose}>
          关闭详单 (ESC)
        </button>
      </div>
    </aside>
  )
}
