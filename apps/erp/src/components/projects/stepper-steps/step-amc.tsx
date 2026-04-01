import {
  Card, CardHeader, CardTitle, CardContent, Badge,
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepAmcData } from '@/lib/project-stepper-queries';
import { CalendarCheck } from 'lucide-react';

interface StepAmcProps {
  projectId: string;
}

export async function StepAmc({ projectId }: StepAmcProps) {
  const visits = await getStepAmcData(projectId);

  if (visits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <CalendarCheck className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
        <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No AMC Visits</h3>
        <p className="text-[13px] text-[#7C818E]">Free AMC visits will be scheduled after commissioning.</p>
      </div>
    );
  }

  const completedCount = visits.filter((v) => v.status === 'completed').length;

  return (
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
