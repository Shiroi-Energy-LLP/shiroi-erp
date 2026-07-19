import * as React from 'react';
import { cn } from '../lib/utils';

export interface FieldHintProps
  extends React.HTMLAttributes<HTMLParagraphElement> {
  error?: boolean;
}

function FieldHint({ error, className, children, ...props }: FieldHintProps) {
  return (
    <p
      className={cn(
        'text-[11px]',
        error ? 'text-[#DC2626]' : 'text-n-500',
        className
      )}
      role={error ? 'alert' : undefined}
      {...props}
    >
      {children}
    </p>
  );
}

export { FieldHint };
