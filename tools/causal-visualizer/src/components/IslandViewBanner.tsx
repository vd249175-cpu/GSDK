import React from 'react'
import type { CausalNode3D } from '../types'

export interface IslandViewBannerProps {
  node: CausalNode3D
  onBackOverview: () => void
}

export const IslandViewBanner: React.FC<IslandViewBannerProps> = ({ node, onBackOverview }) => {
  const icon = node.role === 'observation' ? '🔭' : node.role === 'execution' ? '🎣' : '🏡'
  const roleLabel = node.role === 'observation' ? '观察海岛' : node.role === 'execution' ? '执行海岛' : '纯领域聚落'

  return (
    <div className="island-view-banner">
      <div className="island-view-info">
        <span className="island-view-icon">{icon}</span>
        <div className="island-view-title-wrap">
          <div className="island-view-title">{node.name}</div>
          <div className="island-view-tags">
            <span className={`role-tag ${node.role}`}>{roleLabel}</span>
            <span className="meta-tag">代次: Gen {node.generation ?? 'DROPPED'}</span>
            <span className="meta-tag">版本: v{node.version}</span>
            <span className="meta-tag">航线: ↓{node.inDegree || 0}入 / ↑{node.outDegree || 0}出</span>
          </div>
        </div>
      </div>
      <button className="btn-back-overview" onClick={onBackOverview} title="平滑滑行退回到高空海图全景">
        ⛵ 返回海图全景
      </button>
    </div>
  )
}
