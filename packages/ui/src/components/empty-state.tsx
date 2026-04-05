import * as React from 'react';
import { cn } from '../lib/utils';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4', className)}>
      {icon && (
        <div className="mb-4 text-n-400 opacity-50">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-heading font-bold text-n-700 mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-[13px] text-n-500 max-w-xs text-center mb-4">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
