import React, { type ElementType, type ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ElementType | ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

function renderEmptyIcon(icon?: ElementType | ReactNode) {
  if (!icon) return null;
  if (React.isValidElement(icon)) return icon;
  const IconComp = icon as ElementType;
  return <IconComp className="w-8 h-8 opacity-60 text-[var(--text-secondary)]" />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={'gv-empty-state ' + className}>
      {icon && (
        <div className="gv-empty-state-icon">
          {renderEmptyIcon(icon)}
        </div>
      )}
      <p className="gv-empty-state-title">{title}</p>
      {description && <p className="gv-empty-state-desc">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
