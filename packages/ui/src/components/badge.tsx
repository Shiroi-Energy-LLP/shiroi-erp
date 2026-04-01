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
        success: 'border-transparent bg-[#ECFDF5] text-[#065F46]',
        pending: 'border-transparent bg-[#FFFBEB] text-[#92400E]',
        warning: 'border-transparent bg-[#FFF7ED] text-[#9A3412]',
        error: 'border-transparent bg-[#FEF2F2] text-[#991B1B]',
        info: 'border-transparent bg-[#EFF6FF] text-[#1E40AF]',
        neutral: 'border-transparent bg-[#F3F4F6] text-[#4B5563]',
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
