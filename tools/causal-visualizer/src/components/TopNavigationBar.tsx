import React from 'react'

export interface TopNavigationBarProps {
  isConnected: boolean
  domainCount: number
  obsCount: number
  execCount: number
  routeCount: number
  communityCount: number
  logCount: number
  revision: number
}

export const TopNavigationBar: React.FC<TopNavigationBarProps> = ({
  isConnected,
  domainCount,
  obsCount,
  execCount,
  routeCount,
  communityCount,
  logCount,
  revision,
}) => {
  return (
    <header className="top-bar">
      <div className="title-group">
        <span className="logo-badge">🏝️</span>
        <div>
          <div className="brand-badge">NAUTICAL ARCHIPELAGO · GSDK CAUSAL ENGINE</div>
          <h1>GSDK 3D 像素海岛因果观测仪</h1>
          <div className="subtitle">图无关像素群岛洋流 · 观察灯塔 · 执行渔港 · 领域聚落</div>
        </div>
        {isConnected ? (
          <div className="kernel-badge live">
            <span className="live-dot" />
            <span>内核实时连通</span>
          </div>
        ) : (
          <div className="kernel-badge waiting">
            <span>等待微内核连接</span>
          </div>
        )}
      </div>

      <div className="stats-group">
        <div className="stat-item">
          <span className="label">海岛角色</span>
          <div className="tier-counters">
            <span className="tier-pill domain" title="纯领域聚落海岛">◈ 领域 {domainCount}</span>
            <span className="tier-pill obs" title="观察悬崖灯塔海岛 (感知)">▲ 观察 {obsCount}</span>
            <span className="tier-pill exec" title="执行垂钓渔港海岛 (动作)">▼ 执行 {execCount}</span>
          </div>
        </div>
        <div className="stat-item">
          <span className="label">航运航线</span>
          <span className="value">{routeCount} 条</span>
        </div>
        <div className="stat-item">
          <span className="label">环礁群落</span>
          <span className="value">{communityCount} POD</span>
        </div>
        <div className="stat-item">
          <span className="label">因果遥测</span>
          <span className="value">{logCount} 帧</span>
        </div>
        {revision > 0 && (
          <div className="stat-item">
            <span className="label">内核版本</span>
            <span className="value">#r{revision}</span>
          </div>
        )}
      </div>
    </header>
  )
}
