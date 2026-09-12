import React from 'react'
import type { CausalTelemetryEvent } from '../types'

export interface TelemetryFeedProps {
  logs: CausalTelemetryEvent[]
}

export const TelemetryFeed: React.FC<TelemetryFeedProps> = ({ logs }) => {
  return (
    <aside className="event-feed">
      <div className="feed-header">
        <span>📜 航海因果日志 (Logbook)</span>
        <span className="feed-status">● 实时潮汐</span>
      </div>
      <div className="feed-list">
        {logs.length === 0 ? (
          <div style={{ color: 'var(--vis-text-muted)', fontSize: 11, padding: 12, lineHeight: 1.5 }}>
            &gt; 观测器海图因果监听已就绪。<br />
            &gt; 当微内核发生 ctx.send 时，海面航线将即时起航小帆船并将数据货物送达目标港口。
          </div>
        ) : (
          logs.slice(0, 20).map((log, idx) => (
            <div key={idx} className={`feed-item ${log.type}`}>
              <div className="feed-type">
                {log.type === 'info_sent' && '⛵ 航运'}
                {log.type === 'state_mutated' && '🌾 演进'}
                {log.type === 'root_injected' && '⚓ 注入'}
                {log.type === 'change_start' && '⚡ 推进'}
                {log.type === 'change_end' && '🎉 收敛'}
                {log.type === 'node_admitted' && '🏝️ 准入'}
                {log.type === 'node_evicted' && '🌊 卸载'}
              </div>
              <div className="feed-desc">
                {log.type === 'info_sent' && `${log.fromNodeId} ──► ${log.toNodeId} (${log.info.type})`}
                {log.type === 'state_mutated' && `${log.nodeId} 变迁至 v${log.version}`}
                {log.type === 'root_injected' && `根注入 ──► ${log.targetNodeId} (${log.info.type})`}
                {log.type === 'change_start' && `调度开始: ${log.nodeId} (${log.info.type})`}
                {log.type === 'change_end' && `调度收敛: ${log.nodeId} (${log.durationMs.toFixed(1)}ms)`}
                {log.type === 'node_admitted' && `海岛准入: ${log.nodeId}@Gen${log.generation}`}
                {log.type === 'node_evicted' && `海岛卸载: ${log.nodeId}`}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
