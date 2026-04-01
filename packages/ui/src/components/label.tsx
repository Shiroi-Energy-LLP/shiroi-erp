import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const labelVariants = cva(
  'text-xs font-semibold leading-none text-[#3F424D] peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
);

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement>,
    VariantProps<typeof labelVariants> {}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn(labelVariants(), className)} {...props} />
  )
);
Label.displayName = 'Label';

export { Label };
