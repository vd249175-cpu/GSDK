import React from 'react'
import type { LayoutMode } from '../layout-engine'

export interface BottomControlsDockProps {
  selectedNodeId: string | null
  autoRotate: boolean
  layoutMode: LayoutMode
  onResetCamera: () => void
  onToggleAutoRotate: () => void
  onToggleLayoutMode: () => void
  onFocusSelected: () => void
  onSyncTopology: () => void
  onClearLogs: () => void
}

export const BottomControlsDock: React.FC<BottomControlsDockProps> = ({
  selectedNodeId,
  autoRotate,
  layoutMode,
  onResetCamera,
  onToggleAutoRotate,
  onToggleLayoutMode,
  onFocusSelected,
  onSyncTopology,
  onClearLogs,
}) => {
  return (
    <footer className="bottom-dock">
      <button className="btn-ctrl" onClick={onResetCamera} title="重置摄像机位置，返回高空全景俯瞰 (可随时按键盘 ESC 键)">
        🧭 全景海图 (ESC)
      </button>
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
      {selectedNodeId && (
        <button className="btn-ctrl active" onClick={onFocusSelected} title="镜头平滑推进聚焦到小岛微观视角">
          🔍 聚焦小岛
        </button>
      )}
      <div className="dock-divider" />
      <button className="btn-ctrl" onClick={onSyncTopology} title="重新从微内核拉取最新拓扑快照">
        📡 探查拓扑
      </button>
      <button className="btn-ctrl" onClick={onClearLogs} title="清空航海因果日志记录">
        🧹 翻新海图
      </button>
    </footer>
  )
}
