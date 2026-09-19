import type { ReactNode } from 'react'

export interface IndustrialChipProps {
  label: ReactNode
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'elevated' | 'muted'
  prefix?: ReactNode
  monospace?: boolean
  className?: string
}

export function IndustrialChip({
  label,
  tone = 'default',
  prefix,
  monospace = false,
  className = '',
}: IndustrialChipProps) {
  return (
    <span
      className={`gv-industrial-chip tone-${tone}${monospace ? ' is-mono' : ''} ${className}`.trim()}
    >
      {prefix && <span className="gv-chip-prefix">{prefix}</span>}
      <span className="gv-chip-label">{label}</span>
    </span>
  )
}
