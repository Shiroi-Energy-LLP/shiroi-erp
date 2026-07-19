import * as React from 'react';
import { cn } from '../lib/utils';

export interface CardLabelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Add a bottom hairline rule under the label (section-header style). */
  underline?: boolean;
}

const CardLabel = React.forwardRef<HTMLDivElement, CardLabelProps>(
  ({ className, underline = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'text-[10px] font-semibold uppercase tracking-wider text-n-500',
        underline && 'border-b border-n-150 pb-1.5',
        className
      )}
      {...props}
    />
  )
);
CardLabel.displayName = 'CardLabel';

export { CardLabel };
