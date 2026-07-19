import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../lib/utils';

export interface StageIndicatorStage {
  label: string;
}

export interface StageIndicatorProps {
  stages: StageIndicatorStage[];
  /** Active stage index. Stages before it render as done, after it as upcoming. */
  currentIndex: number;
  /** When provided, stages render as clickable buttons. */
  onStageClick?: (index: number) => void;
  className?: string;
}

/**
 * Generic, routing-free horizontal stage stepper. The app's project detail page
 * has its own route-aware `ProjectStepper`; this is the presentational sibling
 * for anywhere a plain Survey→…→Handover progression is needed.
 */
function StageIndicator({ stages, currentIndex, onStageClick, className }: StageIndicatorProps) {
  return (
    <ol className={cn('flex items-center gap-1 overflow-x-auto py-1', className)}>
      {stages.map((stage, idx) => {
        const isActive = idx === currentIndex;
        const isDone = idx < currentIndex;

        const stateCls = isActive
          ? 'border-shiroi-gold bg-shiroi-gold/10 text-shiroi-gold-dark'
          : isDone
            ? 'border-shiroi-green/40 bg-white text-shiroi-green hover:bg-shiroi-green/5'
            : 'border-n-200 bg-white text-n-500';

        const dotCls = isActive
          ? 'bg-shiroi-gold text-shiroi-ink'
          : isDone
            ? 'bg-shiroi-green text-white'
            : 'bg-n-200 text-n-600';

        const pillCls = cn(
          'flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
          stateCls,
          onStageClick && 'cursor-pointer'
        );

        const inner = (
          <>
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                dotCls
              )}
            >
              {isDone ? <Check className="h-3 w-3" /> : idx + 1}
            </span>
            {stage.label}
          </>
        );

        return (
          <li key={idx} className="flex items-center">
            {onStageClick ? (
              <button
                type="button"
                onClick={() => onStageClick(idx)}
                className={pillCls}
                aria-current={isActive ? 'step' : undefined}
              >
                {inner}
              </button>
            ) : (
              <div className={pillCls} aria-current={isActive ? 'step' : undefined}>
                {inner}
              </div>
            )}
            {idx < stages.length - 1 && (
              <div
                className={cn('h-px w-2', isDone ? 'bg-shiroi-green/40' : 'bg-n-200')}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export { StageIndicator };
