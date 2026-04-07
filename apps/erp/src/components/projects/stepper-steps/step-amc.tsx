import {
  Card, CardHeader, CardTitle, CardContent, Badge,
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepAmcData } from '@/lib/project-stepper-queries';
import { CalendarCheck, CheckCircle2 } from 'lucide-react';
import { AmcScheduleForm } from '@/components/projects/forms/amc-schedule-form';
import { createClient } from '@repo/supabase/server';

interface StepAmcProps {
  projectId: string;
}

export async function StepAmc({ projectId }: StepAmcProps) {
  let visits: Awaited<ReturnType<typeof getStepAmcData>> = [];
  let commissionedDate: string | null = null;

  try {
    visits = await getStepAmcData(projectId);
    const supabase = await createClient();
    const { data } = await supabase
      .from('projects')
      .select('commissioned_date')
      .eq('id', projectId)
      .single();
    commissionedDate = data?.commissioned_date ?? null;
  } catch (error) {
    console.error('[StepAmc] Failed to load AMC data:', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <CalendarCheck className="w-12 h-12 text-red-400 opacity-50 mb-3" />
        <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">Failed to Load</h3>
        <p className="text-[13px] text-[#7C818E]">Could not load AMC data. Please refresh the page.</p>
      </div>
    );
  }

  const hasVisits = visits.length > 0;
  const completedCount = visits.filter((v) => v.status === 'completed').length;
  const overdueCount = visits.filter((v) => {
    if (v.status === 'completed' || v.status === 'cancelled') return false;
    return v.scheduled_date && new Date(v.scheduled_date) < new Date();
  }).length;

  return (
    <div className="space-y-6">
      {/* Show create form only if no visits exist */}
      {!hasVisits && (
        <AmcScheduleForm projectId={projectId} commissionedDate={commissionedDate} />
      )}

      {/* Summary */}
      {hasVisits && (
        <div className="flex gap-3 flex-wrap">
          <div className="px-4 py-3 bg-white border border-n-200 rounded-lg min-w-[100px]">
            <div className="text-xs text-n-500 mb-0.5">Visits</div>
            <div className="text-xl font-bold text-[#1A1D24]">{visits.length}</div>
          </div>
          <div className="px-4 py-3 bg-white border border-green-200 rounded-lg min-w-[100px]">
            <div className="text-xs text-green-600 mb-0.5">Completed</div>
            <div className="text-xl font-bold text-green-700">{completedCount}</div>
          </div>
          {overdueCount > 0 && (
            <div className="px-4 py-3 bg-white border border-red-200 rounded-lg min-w-[100px]">
              <div className="text-xs text-red-600 mb-0.5">Overdue</div>
              <div className="text-xl font-bold text-red-700">{overdueCount}</div>
            </div>
          )}
          {completedCount === visits.length && visits.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium text-green-700">All AMC visits complete</span>
            </div>
          )}
        </div>
      )}

      {hasVisits ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Free AMC Visit Schedule</CardTitle>
            <span className="text-sm text-[#7C818E]">
              {completedCount} / {visits.length} completed
            </span>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Visit #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scheduled Date</TableHead>
                  <TableHead>Engineer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visits.map((visit) => {
                  const engineerName = visit.employees && 'full_name' in visit.employees
                    ? (visit.employees as { full_name: string }).full_name
                    : '\u2014';

                  return (
                    <TableRow key={visit.id}>
                      <TableCell className="font-mono">{visit.visit_number}</TableCell>
                      <TableCell className="capitalize">{visit.visit_type.replace(/_/g, ' ')}</TableCell>
                      <TableCell>{formatDate(visit.scheduled_date)}</TableCell>
                      <TableCell>{engineerName}</TableCell>
                      <TableCell>
                        <VisitStatusBadge status={visit.status} />
                      </TableCell>
                      <TableCell>
                        {visit.completed_at ? formatDate(visit.completed_at.split('T')[0] ?? visit.completed_at) : '\u2014'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col items-center justify-center py-16">
          <CalendarCheck className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No AMC Visits</h3>
          <p className="text-[13px] text-[#7C818E]">Click &quot;Schedule Free AMC Visits&quot; above to create the post-commissioning maintenance schedule.</p>
        </div>
      )}
    </div>
  );
}

function VisitStatusBadge({ status }: { status: string }) {
  const variant = status === 'completed' ? 'success'
    : status === 'scheduled' ? 'info'
    : status === 'overdue' ? 'error'
    : status === 'rescheduled' ? 'warning'
    : status === 'cancelled' ? 'neutral'
    : 'pending';

  return (
    <Badge variant={variant} className="capitalize">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
