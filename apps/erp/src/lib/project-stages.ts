/**
 * Pure helper for deriving which stages of the project stepper should
 * render as "completed" from the current project record.
 *
 * Lives outside of project-stepper.tsx because that file is marked
 * 'use client'. A server component (projects/[id]/layout.tsx) needs to
 * call this helper during render — importing a plain function from a
 * client module would turn it into a client reference and crash with
 * "m is not a function" in production.
 */
export function deriveCompletedStages(project: {
  status: string;
  boi_locked?: boolean | null;
  boq_completed?: boolean | null;
  completion_pct?: number | null;
  commissioned_date?: string | null;
  ceig_cleared?: boolean | null;
  ceig_required?: boolean | null;
}): Record<string, boolean> {
  const status = project.status;
  const isInstalling =
    status === 'in_progress' ||
    status === 'waiting_net_metering' ||
    status === 'completed';
  const isCompleted = status === 'completed';
  const isStarted = status !== 'order_received';

  return {
    details: true, // details is always "done" once the project exists
    survey: isStarted || !!project.boi_locked,
    bom: !!project.boi_locked,
    boq: !!project.boq_completed,
    delivery: isInstalling,
    execution: (project.completion_pct ?? 0) >= 50 || isCompleted,
    actuals: isCompleted,
    qc: isCompleted || (project.completion_pct ?? 0) >= 80,
    liaison: project.ceig_required ? !!project.ceig_cleared : isInstalling,
    commissioning: !!project.commissioned_date || isCompleted,
    amc: isCompleted,
    documents: isCompleted,
  };
}
