import { cn } from '@repo/ui';

export function ScopeBadge({ projectLinked }: { projectLinked: boolean }) {
  return (
    <span className={cn(
      'px-2 py-0.5 rounded border text-xs font-medium',
      projectLinked ? 'bg-slate-100 text-slate-700 border-slate-300' : 'bg-violet-100 text-violet-700 border-violet-300',
    )}>
      {projectLinked ? 'Project-linked' : 'General'}
    </span>
  );
}
