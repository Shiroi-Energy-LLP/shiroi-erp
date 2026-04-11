import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { createClient } from '@repo/supabase/server';
import { getStepQcData } from '@/lib/project-stepper-queries';
import { ShieldCheck, Check, X, Clock, AlertTriangle } from 'lucide-react';
import { QcInspectionForm } from '@/components/projects/forms/qc-inspection-form';
import { QcApprovalControls, QcPdfDownloadButton } from '@/components/projects/forms/qc-approval-controls';
import type { QcChecklistData, QcSectionResult } from '@/lib/qc-constants';

interface StepQcProps {
  projectId: string;
}

export async function StepQc({ projectId }: StepQcProps) {
  const supabase = await createClient();

  // Fetch QC inspections + project system type in parallel
  const [inspections, projectResult] = await Promise.all([
    getStepQcData(projectId),
    supabase
      .from('projects')
      .select('system_type')
      .eq('id', projectId)
      .maybeSingle(),
  ]);

  const systemType = (projectResult.data as any)?.system_type ?? 'on_grid';
  const latestInspection = inspections.length > 0 ? inspections[inspections.length - 1] : null;
  const approvalStatus = (latestInspection as any)?.approval_status ?? null;
  const isApproved = approvalStatus === 'approved';
  const isSubmitted = approvalStatus === 'submitted';
  const isReworkRequired = approvalStatus === 'rework_required';

  // Parse checklist data from latest inspection
  const checklistData = latestInspection?.checklist_items as unknown as QcChecklistData | null;

  // Get inspector and approver names
  const inspectorName =
    latestInspection?.employees && typeof latestInspection.employees === 'object' && 'full_name' in latestInspection.employees
      ? (latestInspection.employees as { full_name: string }).full_name
      : null;

  let approverName: string | null = null;
  if (isApproved && (latestInspection as any)?.approved_by) {
    const { data: approver } = await supabase
      .from('employees')
      .select('full_name')
      .eq('id', (latestInspection as any).approved_by)
      .single();
    approverName = (approver as any)?.full_name ?? null;
  }

  // ── Approved: show completed status ──
  if (isApproved && latestInspection) {
    return (
      <div className="space-y-6">
        {/* Completed banner */}
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100">
            <Check className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <div className="text-sm font-semibold text-green-800">QC Inspection Completed</div>
            <div className="text-xs text-green-700">
              {(latestInspection as any)?.approved_at
                ? `Approved on ${formatDate((latestInspection as any).approved_at)}`
                : `Inspected on ${formatDate(latestInspection.inspection_date)}`}
              {approverName ? ` by ${approverName}` : ''}
            </div>
          </div>
          <div className="ml-auto">
            <QcPdfDownloadButton projectId={projectId} inspectionId={latestInspection.id} />
          </div>
        </div>

        {/* Read-only checklist */}
        {checklistData && <ReadOnlyChecklist data={checklistData} />}
      </div>
    );
  }

  // ── Submitted: pending approval ──
  if (isSubmitted && latestInspection) {
    return (
      <div className="space-y-6">
        {/* Pending banner */}
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <Clock className="h-5 w-5 text-amber-600" />
          <div>
            <div className="text-sm font-semibold text-amber-800">QC Inspection — Pending Approval</div>
            <div className="text-xs text-amber-700">
              Submitted on {formatDate(latestInspection.inspection_date)}
              {inspectorName ? ` by ${inspectorName}` : ''}
            </div>
          </div>
          <div className="ml-auto">
            <QcApprovalControls projectId={projectId} inspectionId={latestInspection.id} />
          </div>
        </div>

        {/* Read-only checklist */}
        {checklistData && <ReadOnlyChecklist data={checklistData} />}
      </div>
    );
  }

  // ── Rework required: show warning + form ──
  if (isReworkRequired && latestInspection) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <div>
            <div className="text-sm font-semibold text-red-800">Rework Required</div>
            <div className="text-xs text-red-700">
              Previous QC inspection was rejected. Please redo the inspection.
              {(latestInspection as any)?.remarks && (
                <span className="block mt-0.5">
                  Notes: {(latestInspection as any).remarks}
                </span>
              )}
            </div>
          </div>
        </div>
        <QcInspectionForm
          projectId={projectId}
          systemType={systemType}
          existingData={checklistData ?? undefined}
        />
      </div>
    );
  }

  // ── No inspection yet: show form ──
  return (
    <div className="space-y-6">
      {inspections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <ShieldCheck className="w-12 h-12 text-n-300 mb-3" />
          <h3 className="text-sm font-semibold text-n-700 mb-1">No QC Inspection Yet</h3>
          <p className="text-xs text-n-500 mb-4">
            Use the structured checklist below to perform the Solar System Quality Check.
          </p>
        </div>
      ) : null}
      <QcInspectionForm projectId={projectId} systemType={systemType} />
    </div>
  );
}

// ── Read-only checklist display (used for submitted/approved states) ──

function ReadOnlyChecklist({ data }: { data: QcChecklistData }) {
  const sections = data.sections ?? [];
  const totalItems = sections.reduce((acc, s) => acc + s.items.length, 0);
  const passedItems = sections.reduce(
    (acc, s) => acc + s.items.filter((i) => i.passed === true).length,
    0,
  );
  const failedItems = totalItems - passedItems;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex gap-3">
        <div className="px-3 py-2 rounded-lg border border-green-200 bg-green-50 text-center min-w-[80px]">
          <div className="text-lg font-bold text-green-700">{passedItems}</div>
          <div className="text-[10px] font-medium text-green-600">Passed</div>
        </div>
        <div className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-center min-w-[80px]">
          <div className="text-lg font-bold text-red-700">{failedItems}</div>
          <div className="text-[10px] font-medium text-red-600">Failed</div>
        </div>
        <div className="px-3 py-2 rounded-lg border border-n-200 bg-n-50 text-center min-w-[80px]">
          <div className="text-lg font-bold text-n-700">{totalItems}</div>
          <div className="text-[10px] font-medium text-n-500">Total Items</div>
        </div>
      </div>

      {/* Sections */}
      {sections.map((section, sIdx) => (
        <Card key={section.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">
              {sIdx + 1}. {section.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-n-200 bg-n-50">
                  <th className="px-3 py-1 text-left text-[10px] font-medium text-n-500 w-[50%]">
                    Check Item
                  </th>
                  <th className="px-3 py-1 text-center text-[10px] font-medium text-n-500 w-[15%]">
                    Result
                  </th>
                  <th className="px-3 py-1 text-left text-[10px] font-medium text-n-500 w-[35%]">
                    Remarks
                  </th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((item, iIdx) => (
                  <tr key={iIdx} className="border-b border-n-50 last:border-b-0">
                    <td className="px-3 py-1.5 text-n-800">{item.item}</td>
                    <td className="px-3 py-1.5 text-center">
                      {item.passed === true ? (
                        <span className="inline-flex items-center gap-0.5 text-green-700 font-semibold">
                          <Check className="h-3 w-3" /> Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-red-700 font-semibold">
                          <X className="h-3 w-3" /> No
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-n-500">{item.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      {/* Overall remarks */}
      {data.remarks && (
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs font-semibold text-n-700 mb-1">Remarks</div>
            <p className="text-xs text-n-600">{data.remarks}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
