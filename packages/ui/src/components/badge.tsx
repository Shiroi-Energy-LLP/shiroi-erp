import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        // V2 status variants
        success: 'border-transparent bg-status-success-bg text-status-success-text',
        pending: 'border-transparent bg-status-warning-bg text-status-warning-text',
        warning: 'border-transparent bg-status-progress-bg text-status-progress-text',
        error: 'border-transparent bg-status-error-bg text-status-error-text',
        info: 'border-transparent bg-status-info-bg text-status-info-text',
        neutral: 'border-transparent bg-status-neutral-bg text-status-neutral-text',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
