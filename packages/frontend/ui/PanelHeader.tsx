import React, { type ElementType, type ReactNode } from 'react';

export interface PanelHeaderProps {
  icon?: ElementType | ReactNode;
  title: string;
  subtitle?: string;
  badge?: string | number | ReactNode;
  actions?: ReactNode;
  className?: string;
}

function renderHeaderIcon(icon?: ElementType | ReactNode) {
  if (!icon) return null;
  if (React.isValidElement(icon)) return icon;
  const IconComp = icon as ElementType;
  return <IconComp className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />;
}

export function PanelHeader({
  icon,
  title,
  subtitle,
  badge,
  actions,
  className = '',
}: PanelHeaderProps) {
  return (
    <header className={'gv-panel-header ' + className}>
      <div className="gv-panel-header-left">
        {renderHeaderIcon(icon)}
        <span className="gv-panel-header-title">{title}</span>
        {subtitle && <span className="gv-panel-header-subtitle">{subtitle}</span>}
        {badge !== undefined && (
          <span className="gv-panel-header-badge">
            {badge}
          </span>
        )}
      </div>
      {actions && <div className="gv-panel-header-actions">{actions}</div>}
    </header>
  );
}
