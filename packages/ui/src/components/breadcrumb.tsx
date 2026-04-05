import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1.5 text-[13px]', className)}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <React.Fragment key={index}>
            {index > 0 && (
              <ChevronRight className="h-3.5 w-3.5 text-n-400 shrink-0" aria-hidden="true" />
            )}
            {isLast || !item.href ? (
              <span
                className={cn(
                  isLast ? 'font-medium text-n-700' : 'text-n-500'
                )}
                aria-current={isLast ? 'page' : undefined}
              >
                {item.label}
              </span>
            ) : (
              <a
                href={item.href}
                className="text-shiroi-green hover:text-shiroi-green-dark hover:underline underline-offset-2 transition-colors"
              >
                {item.label}
              </a>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export { Breadcrumb };
export type { BreadcrumbProps, BreadcrumbItem };
