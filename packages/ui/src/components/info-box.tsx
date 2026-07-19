import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';

const infoBoxVariants = cva(
  'flex gap-2.5 rounded-lg border-l-[3px] px-4 py-3 text-sm',
  {
    variants: {
      variant: {
        info: 'border-l-status-info-border bg-status-info-bg text-status-info-text',
        success: 'border-l-status-success-border bg-status-success-bg text-status-success-text',
        warning: 'border-l-status-warning-border bg-status-warning-bg text-status-warning-text',
        error: 'border-l-status-error-border bg-status-error-bg text-status-error-text',
      },
    },
    defaultVariants: {
      variant: 'info',
    },
  }
);

const DEFAULT_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

export interface InfoBoxProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof infoBoxVariants> {
  title?: React.ReactNode;
  /** Override the default per-variant icon. Pass `null` to suppress the icon entirely. */
  icon?: React.ReactNode;
}

function InfoBox({ className, variant, title, icon, children, ...props }: InfoBoxProps) {
  const v = variant ?? 'info';
  const DefaultIcon = DEFAULT_ICON[v];
  const showIcon = icon !== null;

  return (
    <div
      role={v === 'warning' || v === 'error' ? 'alert' : 'status'}
      className={cn(infoBoxVariants({ variant: v }), className)}
      {...props}
    >
      {showIcon && (
        <span className="mt-0.5 shrink-0">
          {icon ?? <DefaultIcon className="h-4 w-4" />}
        </span>
      )}
      <div className="min-w-0 space-y-0.5">
        {title && <div className="font-semibold">{title}</div>}
        {children && (
          <div className="text-[13px] leading-relaxed opacity-90">{children}</div>
        )}
      </div>
    </div>
  );
}

export { InfoBox, infoBoxVariants };
