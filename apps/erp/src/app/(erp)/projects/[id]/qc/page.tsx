import { notFound } from 'next/navigation';
import { getProject, getProjectQCInspections } from '@/lib/projects-queries';
import { formatDate, toIST } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';

interface QCPageProps {
  params: Promise<{ id: string }>;
}

interface ChecklistItem {
  item: string;
  passed: boolean | null;
  notes?: string;
}

export default async function QCPage({ params }: QCPageProps) {
  const { id } = await params;
  const [project, inspections] = await Promise.all([
    getProject(id),
    getProjectQCInspections(id),
  ]);

  if (!project) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* IR Test Warning Banner */}
      <Card className="border-[#9A3412] bg-[#FFF7ED]">
        <CardContent className="py-3">
          <p className="text-sm text-[#9A3412]">
            <span className="font-medium">IR Test Rule:</span> If insulation resistance reading is below 0.5 M-ohm during commissioning, the database trigger automatically creates a critical service ticket with a 4-hour SLA. This is non-negotiable and cannot be overridden.
          </p>
        </CardContent>
      </Card>

      {/* QC Inspections List */}
      {inspections.length > 0 ? (
        <div className="space-y-4">
          {inspections.map((inspection) => {
            const checklistItems = (inspection.checklist_items as ChecklistItem[] | null) ?? [];
            const passedCount = checklistItems.filter((item) => item.passed === true).length;
            const failedCount = checklistItems.filter((item) => item.passed === false).length;
            const pendingCount = checklistItems.filter((item) => item.passed === null).length;

            return (
              <Card key={inspection.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-base">
                        QC Gate {inspection.gate_number}
                      </CardTitle>
                      <ResultBadge result={inspection.overall_result} />
                      {inspection.requires_reinspection && (
                        <Badge variant="warning">Re-inspection Required</Badge>
                      )}
                      {inspection.payment_gate_unlocked && (
                        <Badge variant="success">Payment Unlocked</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatDate(inspection.inspection_date)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Inspector and milestone */}
                  <div className="flex items-center gap-6 text-sm text-muted-foreground">
                    <span>Inspected by: {inspection.employees?.full_name ?? '—'}</span>
                    <span>Milestone: {inspection.project_milestones?.milestone_name ?? '—'}</span>
                    {inspection.reinspection_of_id && (
                      <span className="text-[#9A3412]">Re-inspection</span>
                    )}
                  </div>

                  {/* Checklist summary */}
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-[#065F46]">{passedCount} passed</span>
                    <span className="text-[#991B1B]">{failedCount} failed</span>
                    {pendingCount > 0 && (
                      <span className="text-[#9A3412]">{pendingCount} pending</span>
                    )}
                  </div>

                  {/* Checklist items */}
                  {checklistItems.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="w-24">Result</TableHead>
                          <TableHead>Notes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {checklistItems.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-sm">{item.item}</TableCell>
                            <TableCell>
                              {item.passed === true && <Badge variant="success">Pass</Badge>}
                              {item.passed === false && <Badge variant="error">Fail</Badge>}
                              {item.passed === null && <Badge variant="neutral">Pending</Badge>}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {item.notes ?? '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}

                  {/* Failure notes */}
                  {inspection.failure_notes && (
                    <div className="bg-[#FEF2F2] border border-[#991B1B] rounded-md px-3 py-2">
                      <div className="text-xs font-medium text-[#991B1B] mb-1">Failure Notes</div>
                      <p className="text-sm text-[#991B1B]">{inspection.failure_notes}</p>
                    </div>
                  )}

                  {/* Conditional notes */}
                  {inspection.conditional_notes && (
                    <div className="bg-[#FFF7ED] border border-[#9A3412] rounded-md px-3 py-2">
                      <div className="text-xs font-medium text-[#9A3412] mb-1">Conditional Notes</div>
                      <p className="text-sm text-[#9A3412]">{inspection.conditional_notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No QC inspections recorded yet.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResultBadge({ result }: { result: string }) {
  switch (result.toLowerCase()) {
    case 'pass':
      return <Badge variant="success">Pass</Badge>;
    case 'fail':
      return <Badge variant="error">Fail</Badge>;
    case 'conditional':
      return <Badge variant="warning">Conditional</Badge>;
    default:
      return <Badge variant="neutral">{result}</Badge>;
  }
}
