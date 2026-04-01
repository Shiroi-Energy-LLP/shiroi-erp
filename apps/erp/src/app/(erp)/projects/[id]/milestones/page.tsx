import { notFound } from 'next/navigation';
import { getProjectMilestones, getProject } from '@/lib/projects-queries';
import { calcWeightedCompletion } from '@/lib/completion-calc';
import { MilestoneStatusBadge } from '@/components/projects/milestone-status-badge';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from '@repo/ui';

interface MilestonesPageProps {
  params: Promise<{ id: string }>;
}

export default async function MilestonesPage({ params }: MilestonesPageProps) {
  const { id } = await params;
  const [project, milestones] = await Promise.all([
    getProject(id),
    getProjectMilestones(id),
  ]);

  if (!project) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Milestone Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div>
              <div className="text-3xl font-bold text-[#1A1D24]">{project.completion_pct}%</div>
              <div className="text-xs text-muted-foreground">Weighted Completion</div>
            </div>
            <div className="flex-1 h-3 rounded-full bg-[#E5E7EB] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  project.completion_pct >= 100 ? 'bg-[#065F46]' :
                  project.completion_pct >= 50 ? 'bg-[#00B050]' : 'bg-[#FCA524]'
                }`}
                style={{ width: `${Math.min(project.completion_pct, 100)}%` }}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              {milestones.filter((m) => m.status === 'completed').length}/{milestones.length} milestones
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Completion % is computed from weighted milestone progress. It is never manually entered.
          </p>
        </CardContent>
      </Card>

      {/* Milestone Steps */}
      <div className="space-y-4">
        {milestones.map((milestone, index) => {
          const isFirst = index === 0;
          const isLast = index === milestones.length - 1;

          return (
            <Card key={milestone.id} className={milestone.is_blocked ? 'border-[#991B1B]' : ''}>
              <CardContent className="py-4">
                <div className="flex items-start gap-4">
                  {/* Step indicator */}
                  <div className="flex flex-col items-center">
                    <MilestoneStepIcon status={milestone.status} order={milestone.milestone_order} />
                    {!isLast && <div className="w-0.5 h-8 bg-[#E5E7EB] mt-1" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-medium text-[#1A1D24]">
                          {milestone.milestone_name}
                        </h3>
                        <MilestoneStatusBadge status={milestone.status} />
                        {milestone.is_payment_gate && (
                          <Badge variant="info">Payment Gate {milestone.payment_gate_number}</Badge>
                        )}
                        {milestone.is_blocked && (
                          <Badge variant="error">Blocked</Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-mono font-medium">{milestone.completion_pct}%</div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-2 w-full h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          milestone.status === 'blocked' ? 'bg-[#991B1B]' :
                          milestone.status === 'completed' ? 'bg-[#065F46]' :
                          milestone.status === 'in_progress' ? 'bg-[#00B050]' : 'bg-[#BFC3CC]'
                        }`}
                        style={{ width: `${Math.min(milestone.completion_pct, 100)}%` }}
                      />
                    </div>

                    {/* Dates */}
                    <div className="mt-2 flex items-center gap-6 text-xs text-muted-foreground">
                      {milestone.planned_start_date && (
                        <span>
                          Planned: {formatDate(milestone.planned_start_date)}
                          {milestone.planned_end_date && ` — ${formatDate(milestone.planned_end_date)}`}
                        </span>
                      )}
                      {milestone.actual_start_date && (
                        <span>
                          Actual: {formatDate(milestone.actual_start_date)}
                          {milestone.actual_end_date && ` — ${formatDate(milestone.actual_end_date)}`}
                        </span>
                      )}
                    </div>

                    {/* Blocked reason */}
                    {milestone.is_blocked && milestone.blocked_reason && (
                      <div className="mt-2 text-xs text-[#991B1B] bg-[#FEF2F2] px-2 py-1 rounded">
                        Blocked: {milestone.blocked_reason}
                        {milestone.blocked_since && (
                          <span className="ml-1">since {formatDate(milestone.blocked_since)}</span>
                        )}
                      </div>
                    )}

                    {/* Payment gate info */}
                    {milestone.is_payment_gate && (
                      <div className="mt-2 text-xs">
                        {milestone.invoice_unlocked ? (
                          <span className="text-[#065F46]">
                            Invoice unlocked
                            {milestone.invoice_unlocked_at && ` on ${formatDate(milestone.invoice_unlocked_at)}`}
                          </span>
                        ) : (
                          <span className="text-[#9A3412]">
                            Invoice locked — complete milestone to unlock payment gate
                          </span>
                        )}
                      </div>
                    )}

                    {/* Completion components */}
                    {milestone.project_completion_components && milestone.project_completion_components.length > 0 && (
                      <div className="mt-3 space-y-1">
                        <div className="text-xs font-medium text-muted-foreground">Components</div>
                        {milestone.project_completion_components.map((comp) => (
                          <div key={comp.id} className="flex items-center justify-between text-xs">
                            <span className="text-[#3E3E3E]">{comp.component_name}</span>
                            <div className="flex items-center gap-2">
                              {comp.requires_photo && (
                                <span className={comp.photo_verified ? 'text-[#065F46]' : 'text-[#9A3412]'}>
                                  {comp.photo_verified ? 'Photo verified' : 'Photo required'}
                                </span>
                              )}
                              <span className="font-mono">{comp.component_pct}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Notes */}
                    {milestone.notes && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {milestone.notes}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {milestones.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No milestones created for this project yet.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MilestoneStepIcon({ status, order }: { status: string; order: number }) {
  const baseClasses = 'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold';
  const statusClasses =
    status === 'completed' ? 'bg-[#065F46] text-white' :
    status === 'in_progress' ? 'bg-[#00B050] text-white' :
    status === 'blocked' ? 'bg-[#991B1B] text-white' :
    'bg-[#E5E7EB] text-[#7C818E]';

  return (
    <div className={`${baseClasses} ${statusClasses}`}>
      {status === 'completed' ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        order
      )}
    </div>
  );
}
