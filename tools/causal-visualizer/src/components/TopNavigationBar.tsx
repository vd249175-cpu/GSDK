import React from 'react'
import type { ParadigmType } from '../renderers/renderer-interface'

export interface TopNavigationBarProps {
  isConnected: boolean
  domainCount: number
  obsCount: number
  execCount: number
  routeCount: number
  communityCount: number
  logCount: number
  revision: number
  activeParadigm: ParadigmType
  onToggleParadigm: () => void
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
  activeParadigm,
  onToggleParadigm,
}) => {
  const isSwiss = activeParadigm === 'swiss-2d'

  return (
    <header className="top-bar">
      <div className="title-group">
        <span className="logo-badge">{isSwiss ? '📐' : '🏝️'}</span>
        <div>
          <div className="brand-badge">
            {isSwiss ? 'SWISS TYPOGRAPHIC CAUSAL DASHBOARD // GSDK' : '⛵ 航海图 · GSDK 因果洋流引擎'}
          </div>
          <h1>{isSwiss ? 'GSDK 2D 瑞士先锋主义因果看板' : 'GSDK 3D 像素海岛因果观测仪'}</h1>
          <div className="subtitle">
            {isSwiss
              ? '国际主义严苛模块化网格 · 曼哈顿正交因果布线 · 极致字重与高反差'
              : '图无关像素群岛洋流 · 观察灯塔 · 执行渔港 · 领域聚落'}
          </div>
        </div>
        {isConnected ? (
          <div className="kernel-badge live" title="微内核原生规则空间已就绪并连通">
            <span className="live-dot" />
            <span>{isSwiss ? 'KERNEL.LIVE' : '🧭 顺风连通中'}</span>
          </div>
        ) : (
          <div className="kernel-badge waiting" title="等待微内核实例连接">
            <span>{isSwiss ? 'KERNEL.WAITING' : '⚓ 待锚定内核'}</span>
          </div>
        )}
      </div>

      <div className="stats-group">
        <button
          className="btn-paradigm-toggle"
          onClick={onToggleParadigm}
          title="在 3D 像素海岛生态 与 2D 瑞士先锋主义看板 之间一键无缝热切换"
        >
          {isSwiss ? '🏝️ 切换: 3D 像素海岛' : '📐 切换: 2D 瑞士先锋'}
        </button>

        <div className="stat-item">
          <span className="label">三向架构</span>
          <div className="tier-counters">
            <span className="tier-pill domain" title="纯领域聚落 (Zero I/O)">
              ◈ 领域 {domainCount}
            </span>
            <span className="tier-pill obs" title="观察感知边界 (零主动写，只感知物理世界)">
              ▲ 观察 {obsCount}
            </span>
            <span className="tier-pill exec" title="执行动作出口 (下发动作，结算即离)">
              ▼ 执行 {execCount}
            </span>
          </div>
        </div>
        <div className="stat-item">
          <span className="label">因果链路</span>
          <span className="value">{isSwiss ? `${routeCount} ROUTES` : `⛵ ${routeCount} 条`}</span>
        </div>
        <div className="stat-item">
          <span className="label">群落 POD</span>
          <span className="value">{isSwiss ? `${communityCount} PODS` : `🏝️ ${communityCount} POD`}</span>
        </div>
        <div className="stat-item">
          <span className="label">遥测日志</span>
          <span className="value">{isSwiss ? `${logCount} FRAMES` : `📜 ${logCount} 帧`}</span>
        </div>
        {revision > 0 && (
          <div className="stat-item">
            <span className="label">内核版本</span>
            <span className="value">{isSwiss ? `REV.#${revision}` : `⚓ #r${revision}`}</span>
          </div>
        )}
      </div>
    </header>
  )
}
