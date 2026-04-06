import {
  Card, CardHeader, CardTitle, CardContent, Badge,
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepQcData } from '@/lib/project-stepper-queries';
import { getProjectMilestones } from '@/lib/project-step-actions';
import { ShieldCheck } from 'lucide-react';
import type { Json } from '@repo/types/database';
import { QcInspectionForm } from '@/components/projects/forms/qc-inspection-form';

interface StepQcProps {
  projectId: string;
}

interface ChecklistItem {
  item: string;
  passed: boolean;
  notes?: string;
}

export async function StepQc({ projectId }: StepQcProps) {
  const [inspections, milestones] = await Promise.all([
    getStepQcData(projectId),
    getProjectMilestones(projectId),
  ]);

  const nextGateNumber = inspections.length > 0
    ? Math.max(...inspections.map((i) => i.gate_number)) + 1
    : 1;

  return (
    <div className="space-y-6">
      {/* Create form */}
      <QcInspectionForm
        projectId={projectId}
        milestones={milestones}
        nextGateNumber={nextGateNumber}
      />

      {inspections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <ShieldCheck className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No QC Inspections</h3>
          <p className="text-[13px] text-[#7C818E]">Click &quot;New QC Inspection&quot; above to record the first quality check.</p>
        </div>
      ) : (
        <>
          {/* Inspections table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">QC Gate Inspections</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Gate #</TableHead>
                    <TableHead>Inspector</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Re-inspect?</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inspections.map((insp) => {
                    const inspectorName = insp.employees && 'full_name' in insp.employees
                      ? (insp.employees as { full_name: string }).full_name
                      : '\u2014';

                    return (
                      <TableRow key={insp.id}>
                        <TableCell className="font-mono">{insp.gate_number}</TableCell>
                        <TableCell>{inspectorName}</TableCell>
                        <TableCell>{formatDate(insp.inspection_date)}</TableCell>
                        <TableCell>
                          <ResultBadge result={insp.overall_result} />
                        </TableCell>
                        <TableCell>
                          {insp.requires_reinspection ? (
                            <Badge variant="warning">Yes</Badge>
                          ) : (
                            <span className="text-[#7C818E]">\u2014</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Checklist details per inspection */}
          {inspections.map((insp) => {
            const items = parseChecklist(insp.checklist_items);
            if (items.length === 0) return null;

            return (
              <Card key={`checklist-${insp.id}`}>
                <CardHeader>
                  <CardTitle className="text-base">Gate {insp.gate_number} &mdash; Checklist</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {items.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm">
                        <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${item.passed ? 'bg-[#ECFDF5] text-[#065F46]' : 'bg-[#FEF2F2] text-[#991B1B]'}`}>
                          {item.passed ? '\u2713' : '\u2717'}
                        </span>
                        <div>
                          <span className="text-[#1A1D24]">{item.item}</span>
                          {item.notes && (
                            <span className="text-[#7C818E] ml-2">&mdash; {item.notes}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

function ResultBadge({ result }: { result: string }) {
  const variant = result === 'pass' ? 'success'
    : result === 'fail' ? 'error'
    : result === 'conditional_pass' ? 'warning'
    : 'neutral';

  return (
    <Badge variant={variant} className="capitalize">
      {result.replace(/_/g, ' ')}
    </Badge>
  );
}

function parseChecklist(raw: Json): ChecklistItem[] {
  if (!raw || !Array.isArray(raw)) return [];
  const result: ChecklistItem[] = [];
  for (const entry of raw) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'item' in entry &&
      'passed' in entry
    ) {
      const obj = entry as Record<string, Json | undefined>;
      result.push({
        item: String(obj.item ?? ''),
        passed: Boolean(obj.passed),
        notes: obj.notes ? String(obj.notes) : undefined,
      });
    }
  }
  return result;
}
