import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepLiaisonData } from '@/lib/project-stepper-queries';
import { Building2, Check, Circle, FileText, Clock, AlertTriangle } from 'lucide-react';
import {
  LiaisonCreateButton,
  DiscomStatusForm,
  CeigStatusForm,
  CeigScopeToggle,
  NetMeterForm,
  FollowupForm,
  LiaisonFieldEditor,
  LiaisonDocUpload,
  LiaisonActivityForm,
} from '@/components/projects/forms/liaison-form';

interface StepLiaisonProps {
  projectId: string;
}

/* ------------------------------------------------------------------ */
/*  Liaison workflow stages                                            */
/* ------------------------------------------------------------------ */

type WorkflowStage = {
  key: string;
  label: string;
  status: 'done' | 'active' | 'pending';
};

function deriveWorkflowStages(app: any, showCeig: boolean): WorkflowStage[] {
  const stages: WorkflowStage[] = [];

  // 1. Application Created
  stages.push({
    key: 'created',
    label: 'Application Created',
    status: 'done',
  });

  // 2. CEIG (if applicable)
  if (showCeig) {
    const ceigDone = app.ceig_status === 'approved';
    const ceigActive = ['applied', 'inspection_scheduled', 'pending'].includes(app.ceig_status);
    stages.push({
      key: 'ceig',
      label: 'CEIG Clearance',
      status: ceigDone ? 'done' : ceigActive ? 'active' : 'pending',
    });
  }

  // 3. DISCOM Applied
  const discomApplied = !['pending', 'not_started'].includes(app.discom_status);
  const discomApproved = ['approved', 'net_meter_installed', 'activated'].includes(app.discom_status);
  stages.push({
    key: 'discom_applied',
    label: 'TNEB Applied',
    status: discomApplied ? 'done' : 'pending',
  });

  // 4. DISCOM Approved
  stages.push({
    key: 'discom_approved',
    label: 'TNEB Approved',
    status: discomApproved ? 'done' : discomApplied && !discomApproved ? 'active' : 'pending',
  });

  // 5. Net Meter Installed
  stages.push({
    key: 'net_meter',
    label: 'Meter Installed',
    status: app.net_meter_installed ? 'done' : discomApproved ? 'active' : 'pending',
  });

  // 6. Activated
  const activated = app.discom_status === 'activated';
  stages.push({
    key: 'activated',
    label: 'Activated',
    status: activated ? 'done' : app.net_meter_installed ? 'active' : 'pending',
  });

  return stages;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export async function StepLiaison({ projectId }: StepLiaisonProps) {
  let liaisonData: Awaited<ReturnType<typeof getStepLiaisonData>>;

  try {
    liaisonData = await getStepLiaisonData(projectId);
  } catch (error) {
    console.error('[StepLiaison] Failed to load data:', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Building2 className="w-12 h-12 text-red-400 opacity-50 mb-3" />
        <h3 className="text-sm font-semibold text-n-700 mb-1">Failed to Load</h3>
        <p className="text-xs text-n-500">Could not load liaison data. Please refresh the page.</p>
      </div>
    );
  }

  const { project, application, documents } = liaisonData;

  if (!application) {
    return (
      <div>
        <LiaisonCreateButton projectId={projectId} />
        <div className="flex flex-col items-center justify-center py-16">
          <Building2 className="w-12 h-12 text-n-400 opacity-50 mb-3" />
          <h3 className="text-sm font-semibold text-n-700 mb-1">No Net Metering Application</h3>
          <p className="text-xs text-n-500 max-w-md text-center">
            Click &quot;Start Net Metering Application&quot; above to begin the liaison process.
          </p>
        </div>
      </div>
    );
  }

  // CEIG (Chief Electrical Inspectorate General) clearance is mandatory in Tamil Nadu
  // for any grid-connected solar ≥10 kWp. It's the gate for TNEB net metering.
  // Rule: show CEIG for any project ≥10 kWp unless it's purely off-grid.
  // (Previous code had `system_type !== 'on_grid'` which was backwards — it HID CEIG
  // for the exact systems that need it, which is why Manivel saw 0 CEIG workflows on
  // projects over 10 kW. Also bumped the threshold from `> 10` to `>= 10` to match
  // TN's regulatory cutoff.)
  const sizeKwp = Number((project as any).system_size_kwp ?? 0);
  const systemType = (project as any).system_type;
  const showCeig =
    application.ceig_required || (sizeKwp >= 10 && systemType !== 'off_grid');
  const stages = deriveWorkflowStages(application, showCeig);

  return (
    <div className="space-y-6">
      {/* ── Visual Workflow Bar ── */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between">
            {stages.map((stage, idx) => (
              <div key={stage.key} className="flex items-center flex-1 last:flex-0">
                <div className="flex flex-col items-center min-w-0">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                      stage.status === 'done'
                        ? 'bg-green-100 text-green-700 border-2 border-green-400'
                        : stage.status === 'active'
                          ? 'bg-blue-100 text-blue-700 border-2 border-blue-400 animate-pulse'
                          : 'bg-n-100 text-n-400 border-2 border-n-200'
                    }`}
                  >
                    {stage.status === 'done' ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Circle className="h-3 w-3" />
                    )}
                  </div>
                  <span
                    className={`text-[9px] mt-1 text-center leading-tight max-w-[72px] ${
                      stage.status === 'done'
                        ? 'text-green-700 font-medium'
                        : stage.status === 'active'
                          ? 'text-blue-700 font-medium'
                          : 'text-n-400'
                    }`}
                  >
                    {stage.label}
                  </span>
                </div>
                {idx < stages.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-1 mt-[-14px] ${
                      stage.status === 'done' ? 'bg-green-300' : 'bg-n-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* DISCOM / TNEB */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">TNEB / DISCOM Status</CardTitle>
              <DiscomStatusForm projectId={projectId} currentStatus={application.discom_status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-[11px]">
            <FieldRow label="DISCOM" value={application.discom_name} />
            <FieldRow label="Status">
              <DiscomStatusBadge status={application.discom_status} />
            </FieldRow>
            <EditableFieldRow
              label="Application No."
              field="discom_application_number"
              value={application.discom_application_number}
              projectId={projectId}
              mono
            />
            <EditableFieldRow
              label="Application Date"
              field="discom_application_date"
              value={application.discom_application_date}
              projectId={projectId}
              type="date"
            />
          </CardContent>
        </Card>

        {/* Net Meter */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Net Meter Installation</CardTitle>
              <NetMeterForm projectId={projectId} installed={application.net_meter_installed} />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-[11px]">
            <FieldRow label="Meter Installed">
              <Badge variant={application.net_meter_installed ? 'success' : 'warning'} className="text-[10px]">
                {application.net_meter_installed ? 'Installed' : 'Pending'}
              </Badge>
            </FieldRow>
            <EditableFieldRow
              label="Installation Date"
              field="net_meter_installed_date"
              value={application.net_meter_installed_date}
              projectId={projectId}
              type="date"
            />
            <EditableFieldRow
              label="Meter Serial"
              field="net_meter_serial_number"
              value={application.net_meter_serial_number}
              projectId={projectId}
              mono
            />
          </CardContent>
        </Card>

        {/* CEIG (if applicable) */}
        {showCeig && (
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">CEIG Clearance</CardTitle>
                <div className="flex items-center gap-3">
                  <CeigScopeToggle
                    applicationId={application.id}
                    currentScope={(application as any).ceig_scope ?? null}
                  />
                  {(application as any).ceig_scope !== 'client' && (
                    <CeigStatusForm projectId={projectId} currentStatus={application.ceig_status} />
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {(application as any).ceig_scope === 'client' ? (
                <div className="flex items-center gap-2 py-3 text-sm text-blue-600">
                  <Building2 className="w-4 h-4 flex-shrink-0" />
                  <div>
                    <span className="font-medium">CEIG managed by Client</span>
                    <p className="text-xs text-n-500 mt-0.5">
                      Client is handling the CEIG clearance process for this project.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[11px]">
                  <div>
                    <span className="text-n-500 block mb-0.5">Status</span>
                    <CeigStatusBadge status={application.ceig_status} />
                  </div>
                  <EditableFieldRow
                    label="Application Date"
                    field="ceig_application_date"
                    value={application.ceig_application_date}
                    projectId={projectId}
                    type="date"
                    inline
                  />
                  <EditableFieldRow
                    label="Inspection Date"
                    field="ceig_inspection_date"
                    value={application.ceig_inspection_date}
                    projectId={projectId}
                    type="date"
                    inline
                  />
                  <EditableFieldRow
                    label="Approval Date"
                    field="ceig_approval_date"
                    value={application.ceig_approval_date}
                    projectId={projectId}
                    type="date"
                    inline
                  />
                  <EditableFieldRow
                    label="Certificate No."
                    field="ceig_certificate_number"
                    value={application.ceig_certificate_number}
                    projectId={projectId}
                    mono
                    inline
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Follow-up Tracking */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Follow-up Tracking</CardTitle>
              <span className="text-[10px] text-n-500 font-mono">
                {application.followup_count ?? 0} follow-ups
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-[11px]">
            <FieldRow label="Last Follow-up" value={application.last_followup_date ? formatDate(application.last_followup_date) : null} />
            <FieldRow label="Next Follow-up">
              {application.next_followup_date ? (
                <span className={`font-medium ${
                  new Date(application.next_followup_date) < new Date() ? 'text-red-600' : 'text-n-900'
                }`}>
                  {formatDate(application.next_followup_date)}
                  {new Date(application.next_followup_date) < new Date() && (
                    <AlertTriangle className="h-3 w-3 inline ml-1 text-red-500" />
                  )}
                </span>
              ) : (
                <span className="text-n-400">{'\u2014'}</span>
              )}
            </FieldRow>
            <div className="pt-2">
              <FollowupForm projectId={projectId} />
            </div>
          </CardContent>
        </Card>

        {/* Documents */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Liaison Documents</CardTitle>
              <span className="text-[10px] text-n-400">{documents.length} docs</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {documents.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-n-200 bg-n-50">
                      <th className="px-3 py-1 text-left text-[10px] font-medium text-n-500">Type</th>
                      <th className="px-3 py-1 text-left text-[10px] font-medium text-n-500">Name</th>
                      <th className="px-3 py-1 text-left text-[10px] font-medium text-n-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => (
                      <tr key={doc.id} className="border-b border-n-50 last:border-b-0">
                        <td className="px-3 py-1 text-n-500 capitalize">{doc.document_type.replace(/_/g, ' ')}</td>
                        <td className="px-3 py-1 text-n-900">{doc.document_name}</td>
                        <td className="px-3 py-1">
                          <Badge
                            variant={doc.status === 'accepted' ? 'success' : doc.status === 'rejected' ? 'destructive' : 'warning'}
                            className="text-[9px]"
                          >
                            {doc.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="p-3 border-t border-n-100">
              <LiaisonDocUpload
                projectId={projectId}
                netMeteringId={application.id}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Notes / Activity Log ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Notes &amp; Activity Log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {application.notes && (
            <div className="bg-n-50 rounded-md px-3 py-2">
              <p className="text-xs text-n-700 whitespace-pre-wrap">{application.notes}</p>
            </div>
          )}
          <LiaisonActivityForm projectId={projectId} />
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper components                                                  */
/* ------------------------------------------------------------------ */

function FieldRow({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-n-500">{label}</span>
      {children ?? (
        <span className={`font-medium text-n-900 ${mono ? 'font-mono' : ''}`}>
          {value || '\u2014'}
        </span>
      )}
    </div>
  );
}

function EditableFieldRow({
  label,
  field,
  value,
  projectId,
  type,
  mono,
  inline,
}: {
  label: string;
  field: string;
  value: string | null;
  projectId: string;
  type?: 'date' | 'text';
  mono?: boolean;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div>
        <span className="text-n-500 block mb-0.5">{label}</span>
        <LiaisonFieldEditor
          projectId={projectId}
          field={field}
          value={value}
          type={type ?? 'text'}
          mono={mono}
        />
      </div>
    );
  }
  return (
    <div className="flex justify-between items-center">
      <span className="text-n-500">{label}</span>
      <LiaisonFieldEditor
        projectId={projectId}
        field={field}
        value={value}
        type={type ?? 'text'}
        mono={mono}
      />
    </div>
  );
}

function DiscomStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'approved' || status === 'activated' || status === 'net_meter_installed'
      ? 'success'
      : status === 'rejected'
        ? 'destructive'
        : status === 'objection_raised'
          ? 'destructive'
          : status === 'submitted' || status === 'under_review' || status === 'site_inspection_scheduled'
            ? 'info'
            : 'warning';
  return (
    <Badge variant={variant} className="text-[10px] capitalize">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

function CeigStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'approved'
      ? 'success'
      : status === 'rejected'
        ? 'destructive'
        : status === 'not_required' || status === 'not_applicable'
          ? 'info'
          : 'warning';
  return (
    <Badge variant={variant} className="text-[10px] capitalize">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
