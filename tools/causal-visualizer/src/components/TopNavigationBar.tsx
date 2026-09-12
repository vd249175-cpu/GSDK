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
          <div className="brand-badge">⛵ 航海图 · GSDK 因果洋流引擎</div>
          <h1>GSDK 3D 像素海岛因果观测仪</h1>
          <div className="subtitle">图无关像素群岛洋流 · 观察灯塔 · 执行渔港 · 领域聚落</div>
        </div>
        {isConnected ? (
          <div className="kernel-badge live" title="微内核原生规则空间已就绪并连通">
            <span className="live-dot" />
            <span>🧭 顺风连通中</span>
          </div>
        ) : (
          <div className="kernel-badge waiting" title="等待微内核实例连接">
            <span>⚓ 待锚定内核</span>
          </div>
        )}
      </div>

      <div className="stats-group">
        <div className="stat-item">
          <span className="label">海岛角色</span>
          <div className="tier-counters">
            <span className="tier-pill domain" title="纯领域聚落海岛 (Zero I/O)">◈ 领域 {domainCount}</span>
            <span className="tier-pill obs" title="观察悬崖灯塔海岛 (零主动写，只感知物理世界)">▲ 观察 {obsCount}</span>
            <span className="tier-pill exec" title="执行垂钓渔港海岛 (下发动作，结算即离)">▼ 执行 {execCount}</span>
          </div>
        </div>
        <div className="stat-item">
          <span className="label">航运航线</span>
          <span className="value">⛵ {routeCount} 条</span>
        </div>
        <div className="stat-item">
          <span className="label">环礁群落</span>
          <span className="value">🏝️ {communityCount} POD</span>
        </div>
        <div className="stat-item">
          <span className="label">航海日志</span>
          <span className="value">📜 {logCount} 帧</span>
        </div>
        {revision > 0 && (
          <div className="stat-item">
            <span className="label">内核版本</span>
            <span className="value">⚓ #r{revision}</span>
          </div>
        )}
      </div>
    </header>
  )
}
