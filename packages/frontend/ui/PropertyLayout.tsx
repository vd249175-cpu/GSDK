import React, { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface PropertySectionProps {
  title: string;
  defaultExpanded?: boolean;
  badge?: string | number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PropertySection({
  title,
  defaultExpanded = true,
  badge,
  actions,
  children,
  className = '',
}: PropertySectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <section className={'gv-property-section ' + className}>
      <button
        type="button"
        className="gv-property-section-btn"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="gv-property-section-left">
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" />
          )}
          <span className="truncate">{title}</span>
          {badge !== undefined && (
            <span className="gv-panel-header-badge">
              {badge}
            </span>
          )}
        </div>
        {actions && (
          <div
            className="flex items-center gap-1 shrink-0"
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </button>
      {isExpanded && <div className="gv-property-section-content">{children}</div>}
    </section>
  );
}

export interface PropertyRowProps {
  label: string;
  description?: string;
  inline?: boolean;
  children: ReactNode;
  className?: string;
}

export function PropertyRow({
  label,
  description,
  inline = false,
  children,
  className = '',
}: PropertyRowProps) {
  return (
    <div className={(inline ? 'gv-property-row gv-property-row-inline' : 'gv-property-row') + ' ' + className}>
      <div className="min-w-0">
        <label className="gv-property-row-label">
          {label}
        </label>
        {description && (
          <span className="gv-property-row-desc">{description}</span>
        )}
      </div>
      <div className={inline ? 'shrink-0 min-w-0' : 'w-full'}>{children}</div>
    </div>
  );
}
