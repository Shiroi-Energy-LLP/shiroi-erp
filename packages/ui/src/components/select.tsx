import * as React from 'react';
import { cn } from '../lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          'flex h-9 w-full rounded-md border-[1.5px] border-[#DFE2E8] bg-white px-3 py-1 text-[13px] text-[#1A1D24] transition-all duration-150 focus-visible:outline-none focus-visible:border-[#00B050] focus-visible:shadow-[0_0_0_3px_rgba(0,176,80,0.1)] disabled:cursor-not-allowed disabled:bg-[#F8F9FB] disabled:text-[#9CA0AB]',
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = 'Select';

export { Select };
