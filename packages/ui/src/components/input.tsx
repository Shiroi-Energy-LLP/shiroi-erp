import * as React from 'react';
import { cn } from '../lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border-[1.5px] border-n-200 bg-white px-3 py-1 text-[13px] text-n-900 transition-all duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-n-500 focus-visible:outline-none focus-visible:border-shiroi-green focus-visible:shadow-[0_0_0_3px_rgba(0,176,80,0.1)] disabled:cursor-not-allowed disabled:bg-n-050 disabled:text-n-400',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
