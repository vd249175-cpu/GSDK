import type { ReactNode } from 'react'
import { IndustrialChip } from './IndustrialChip'

export interface NodePortPin {
  id: string
  label?: string
  active?: boolean
}

export interface NodeCardProps {
  nodeId: string
  title?: string
  subtitle?: string
  generation?: number | null
  status?: string
  statusTone?: 'idle' | 'active' | 'warning' | 'danger' | 'evicted'
  selected?: boolean
  ports?: {
    in?: NodePortPin[]
    out?: NodePortPin[]
  }
  properties?: Array<{
    label: string
    value: ReactNode
    monospace?: boolean
  }>
  onClick?: () => void
  className?: string
  children?: ReactNode
}

export function NodeCard({
  nodeId,
  title,
  subtitle,
  generation,
  status,
  statusTone = 'idle',
  selected = false,
  ports,
  properties,
  onClick,
  className = '',
  children,
}: NodeCardProps) {
  const isEvicted = statusTone === 'evicted' || generation === null

  return (
    <div
      className={`gv-node-card${selected ? ' is-selected' : ''}${isEvicted ? ' is-evicted' : ''} ${className}`.trim()}
      onClick={onClick}
      role="button"
      tabIndex={onClick ? 0 : undefined}
    >
      {/* 节点标题栏 */}
      <div className="gv-node-header">
        <div className="gv-node-title-cluster">
          <span className="gv-node-id">{nodeId}</span>
          {title && <span className="gv-node-label">{title}</span>}
        </div>
        <div className="gv-node-badges">
          {generation !== undefined && generation !== null && (
            <IndustrialChip
              label={`GEN ${generation}`}
              tone={generation > 0 ? 'elevated' : 'default'}
              monospace
            />
          )}
          {status && (
            <IndustrialChip
              label={status}
              tone={statusTone === 'evicted' ? 'danger' : statusTone === 'active' ? 'accent' : 'muted'}
              monospace
            />
          )}
        </div>
      </div>

      {subtitle && <div className="gv-node-subtitle">{subtitle}</div>}

      {/* 端口与内容主体 */}
      <div className="gv-node-body">
        {ports && (
          <div className="gv-node-ports-row">
            <div className="gv-node-ports-in">
              {ports.in?.map((p) => (
                <div key={p.id} className={`gv-port-pin is-in${p.active ? ' is-active' : ''}`} title={p.id}>
                  <span className="gv-port-dot" />
                  {p.label && <span className="gv-port-label">{p.label}</span>}
                </div>
              ))}
            </div>
            <div className="gv-node-ports-out">
              {ports.out?.map((p) => (
                <div key={p.id} className={`gv-port-pin is-out${p.active ? ' is-active' : ''}`} title={p.id}>
                  {p.label && <span className="gv-port-label">{p.label}</span>}
                  <span className="gv-port-dot" />
                </div>
              ))}
            </div>
          </div>
        )}

        {properties && properties.length > 0 && (
          <div className="gv-node-props-table">
            {properties.map((prop, idx) => (
              <div key={idx} className="gv-node-prop-item">
                <span className="gv-node-prop-key">{prop.label}</span>
                <span className={`gv-node-prop-val${prop.monospace ? ' is-mono' : ''}`}>
                  {prop.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {children}
      </div>
    </div>
  )
}
