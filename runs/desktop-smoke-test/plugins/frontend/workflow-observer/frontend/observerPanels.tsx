import { createContext, useContext } from 'react'
import { Activity } from 'lucide-react'
import type { PanelDefinition, PanelProps } from '@graphframework/workbench'
import { IndustrialChip, PropertyRow, PropertySection } from '@graphframework/ui'
import type { ObserverSnapshot } from './app'

export const ObserverContext = createContext<{ snapshot: ObserverSnapshot | null } | null>(null)

const formatValue = (value: unknown) => {
  if (value === null || value === undefined) return '–'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function WatchPanel(_props: PanelProps) {
  const context = useContext(ObserverContext)
  if (!context) throw new Error('WatchPanel requires ObserverContext')
  const { snapshot } = context
  const status = snapshot?.sessionStatus ?? 'unknown'
  const tone = status === 'error' ? 'danger' : status === 'done' ? 'success' : status === 'awaiting-confirmation' ? 'warning' : 'accent'

  return (
    <div className="panel-container observer-panel-root">
      <div className="observer-layout">
        <div className="sidebar-section-title">操作观察</div>
        <IndustrialChip label={status} tone={tone} monospace />
        {snapshot?.lastError && <div className="observer-error">{snapshot.lastError}</div>}
        {snapshot?.pendingConfirmation && (
          <div className="observer-pending">
            图已停在 {snapshot.pendingConfirmation.step}，等待 Agent 调用独立交互弹窗。
          </div>
        )}
        <PropertySection title="指定字段">
          {snapshot?.watchedFields.map((field) => (
            <PropertyRow key={`${field.nodeId}:${field.path}`} label={field.label} value={formatValue(field.value)} monospace />
          ))}
        </PropertySection>
        <PropertySection title="指定 Info">
          {snapshot?.infoHistoryTruncated && <div className="observer-pending">因果事件历史已截断</div>}
          {snapshot?.watchedInfos.length === 0 && <div className="observer-empty">尚无匹配的 Info</div>}
          {snapshot?.watchedInfos.map((event) => (
            <div className="observer-info-row" key={event.cursor}>
              <code>#{event.cursor}</code>
              <strong>{event.infoType}</strong>
              <span>{event.kind}</span>
              <code>{event.nodeId ?? event.targetNodeId ?? '–'}</code>
            </div>
          ))}
        </PropertySection>
      </div>
    </div>
  )
}

export const OBSERVER_PANEL_DEFINITIONS: PanelDefinition[] = [
  { id: 'observer.watch', title: '操作观察', icon: Activity, component: WatchPanel },
]
