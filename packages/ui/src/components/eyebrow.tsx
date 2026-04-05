import * as React from 'react';
import { cn } from '../lib/utils';

interface EyebrowProps {
  children: React.ReactNode;
  className?: string;
}

function Eyebrow({ children, className }: EyebrowProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="w-3.5 h-0.5 rounded-full bg-shiroi-green shrink-0" />
      <span className="text-[10px] font-heading font-bold uppercase tracking-[0.14em] text-shiroi-green">
        {children}
      </span>
    </div>
  );
}

export { Eyebrow };
export type { EyebrowProps };
