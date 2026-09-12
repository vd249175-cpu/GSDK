import React from 'react'
import type { LayoutMode } from '../layout-engine'
import type { ParadigmType } from '../renderers/renderer-interface'

export interface BottomControlsDockProps {
  selectedNodeId: string | null
  autoRotate: boolean
  layoutMode: LayoutMode
  activeParadigm: ParadigmType
  onResetCamera: () => void
  onToggleAutoRotate: () => void
  onToggleLayoutMode: () => void
  onFocusSelected: () => void
  onSyncTopology: () => void
  onClearLogs: () => void
  onToggleParadigm: () => void
}

export const BottomControlsDock: React.FC<BottomControlsDockProps> = ({
  selectedNodeId,
  autoRotate,
  layoutMode,
  activeParadigm,
  onResetCamera,
  onToggleAutoRotate,
  onToggleLayoutMode,
  onFocusSelected,
  onSyncTopology,
  onClearLogs,
  onToggleParadigm,
}) => {
  const isSwiss = activeParadigm === 'swiss-2d'

  return (
    <footer className="bottom-dock">
      <button
        className="btn-ctrl btn-paradigm-pill"
        onClick={onToggleParadigm}
        title="在 3D 像素海岛生态 与 2D 瑞士先锋主义看板 之间切换"
      >
        {isSwiss ? '📐 范式: 2D 瑞士看板' : '🏝️ 范式: 3D 像素海岛'}
      </button>

      <div className="dock-divider" />

      <button
        className="btn-ctrl"
        onClick={onResetCamera}
        title={isSwiss ? '平移复位，居中展示全局模块网格 (ESC)' : '重置摄像机位置，返回高空全景俯瞰 (ESC)'}
      >
        {isSwiss ? '⌂ 全局居中 (ESC)' : '🧭 全景海图 (ESC)'}
      </button>

      {!isSwiss && (
        <>
          <button
            className={`btn-ctrl ${autoRotate ? 'active' : ''}`}
            onClick={onToggleAutoRotate}
            title="开启/停止 海洋空间缓速巡航自转"
          >
            {autoRotate ? '🌊 巡航慢转:开' : '🌊 巡航慢转:关'}
          </button>
          <button className="btn-ctrl" onClick={onToggleLayoutMode} title="切换 3D 拓扑群落聚类与因果洋流流水线布局">
            {layoutMode === 'community' ? '🗺️ 排布:LPA群岛' : '🌊 排布:因果洋流'}
          </button>
        </>
      )}

      {selectedNodeId && (
        <button className="btn-ctrl active" onClick={onFocusSelected} title="聚焦查看选中节点">
          🔍 {isSwiss ? '聚焦模块' : '聚焦小岛'}
        </button>
      )}

      <div className="dock-divider" />

      <button className="btn-ctrl" onClick={onSyncTopology} title="重新从微内核拉取最新拓扑快照">
        📡 {isSwiss ? 'SYNC.TOPOLOGY' : '探查拓扑'}
      </button>
      <button className="btn-ctrl" onClick={onClearLogs} title="清空航海因果日志记录">
        🧹 {isSwiss ? 'CLEAR.LOGS' : '翻新海图'}
      </button>
    </footer>
  )
}
