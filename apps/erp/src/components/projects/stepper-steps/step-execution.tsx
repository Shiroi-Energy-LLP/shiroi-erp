import {
  Card, CardHeader, CardTitle, CardContent, Badge, Button,
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@repo/ui';
import { getStepExecutionData } from '@/lib/project-stepper-queries';
import { MilestoneStatusBadge } from '@/components/projects/milestone-status-badge';
import { HardHat } from 'lucide-react';
import Link from 'next/link';

interface StepExecutionProps {
  projectId: string;
}

export async function StepExecution({ projectId }: StepExecutionProps) {
  const { milestones, reportCount } = await getStepExecutionData(projectId);

  if (milestones.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <HardHat className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
        <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Milestones</h3>
        <p className="text-[13px] text-[#7C818E]">Project milestones will appear here once execution planning begins.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex gap-4">
        <Card className="flex-1">
          <CardContent className="p-4">
            <div className="text-xs text-[#7C818E] mb-0.5">Total Milestones</div>
            <div className="text-xl font-bold text-[#1A1D24]">{milestones.length}</div>
          </CardContent>
        </Card>
        <Card className="flex-1">
          <CardContent className="p-4">
            <div className="text-xs text-[#7C818E] mb-0.5">Completed</div>
            <div className="text-xl font-bold text-[#065F46]">
              {milestones.filter((m) => m.status === 'completed').length}
            </div>
          </CardContent>
        </Card>
        <Card className="flex-1">
          <CardContent className="p-4">
            <div className="text-xs text-[#7C818E] mb-0.5">In Progress</div>
            <div className="text-xl font-bold text-[#1E40AF]">
              {milestones.filter((m) => m.status === 'in_progress').length}
            </div>
          </CardContent>
        </Card>
        <Card className="flex-1">
          <CardContent className="p-4">
            <div className="text-xs text-[#7C818E] mb-0.5">Daily Reports</div>
            <div className="text-xl font-bold text-[#1A1D24]">{reportCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Milestones table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Milestones</CardTitle>
          <Link href={`/projects/${projectId}?tab=qc`}>
            <Button size="sm" variant="ghost" className="text-xs">
              Continue to QC →
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Milestone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead>Blocked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {milestones.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-[#7C818E]">{m.milestone_order}</TableCell>
                  <TableCell className="font-medium">{m.milestone_name}</TableCell>
                  <TableCell>
                    <MilestoneStatusBadge status={m.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono">{m.completion_pct}%</TableCell>
                  <TableCell>
                    {m.is_blocked ? (
                      <div>
                        <Badge variant="error">Blocked</Badge>
                        {m.blocked_reason && (
                          <div className="text-xs text-[#991B1B] mt-0.5">{m.blocked_reason}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-[#7C818E]">\u2014</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
