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
      <button className="btn-ctrl" onClick={onResetCamera} title="重置摄像机位置，返回高空全景俯瞰 (或按 ESC 键)">
        ⛵ 全景海图 (ESC)
      </button>
      <button
        className="btn-ctrl"
        style={{ borderColor: autoRotate ? 'var(--vis-accent)' : undefined }}
        onClick={onToggleAutoRotate}
        title="开启/停止 3D 空间缓慢自转"
      >
        {autoRotate ? '⏸️ 慢转:开' : '🔄 慢转:关'}
      </button>
      <button className="btn-ctrl" onClick={onToggleLayoutMode} title="切换 3D 拓扑群落聚类与因果流水线布局">
        {layoutMode === 'community' ? '🪐 排布:LPA群岛' : '🌊 排布:因果流水线'}
      </button>
      {selectedNodeId && (
        <button className="btn-ctrl active" onClick={onFocusSelected} title="镜头推进聚焦到小岛微观视角">
          🔍 小岛视角
        </button>
      )}
      <div className="dock-divider" />
      <button className="btn-ctrl" onClick={onSyncTopology} title="重新从微内核拉取最新拓扑快照">
        🌌 同步拓扑
      </button>
      <button className="btn-ctrl" onClick={onClearLogs} title="清空历史事件流">
        🧹 清屏
      </button>
    </footer>
  )
}
