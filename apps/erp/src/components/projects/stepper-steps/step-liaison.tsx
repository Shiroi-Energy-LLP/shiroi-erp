import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepLiaisonData } from '@/lib/project-stepper-queries';
import { Building2 } from 'lucide-react';

interface StepLiaisonProps {
  projectId: string;
}

export async function StepLiaison({ projectId }: StepLiaisonProps) {
  const { project, application } = await getStepLiaisonData(projectId);

  if (!application) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Building2 className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
        <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Net Metering Application</h3>
        <p className="text-[13px] text-[#7C818E]">Net metering liaison tracking will appear here once an application is filed.</p>
      </div>
    );
  }

  const showCeig = application.ceig_required || (project.system_size_kwp > 10 && project.system_type !== 'on_grid');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* DISCOM / TNEB Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">TNEB / DISCOM Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InfoRow label="DISCOM" value={application.discom_name} />
          <InfoRow label="Application No." value={application.discom_application_number} mono />
          <div className="flex justify-between text-sm items-center">
            <span className="text-[#7C818E]">Status</span>
            <DiscomStatusBadge status={application.discom_status} />
          </div>
          <InfoRow label="Application Date" value={application.discom_application_date ? formatDate(application.discom_application_date) : null} />
          <InfoRow label="Followup Count" value={application.followup_count?.toString()} />
          <InfoRow label="Next Followup" value={application.next_followup_date ? formatDate(application.next_followup_date) : null} />
        </CardContent>
      </Card>

      {/* Net Meter Installation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Net Meter Installation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm items-center">
            <span className="text-[#7C818E]">Meter Installed</span>
            <Badge variant={application.net_meter_installed ? 'success' : 'pending'}>
              {application.net_meter_installed ? 'Yes' : 'Pending'}
            </Badge>
          </div>
          <InfoRow label="Installation Date" value={application.net_meter_installed_date ? formatDate(application.net_meter_installed_date) : null} />
          <InfoRow label="Meter Serial" value={application.net_meter_serial_number} mono />
        </CardContent>
      </Card>

      {/* CEIG (if applicable) */}
      {showCeig && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">CEIG Clearance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-[#7C818E] mb-0.5">Status</div>
                <CeigStatusBadge status={application.ceig_status} />
              </div>
              <div>
                <div className="text-xs text-[#7C818E] mb-0.5">Application Date</div>
                <div className="text-sm font-medium text-[#1A1D24]">
                  {application.ceig_application_date ? formatDate(application.ceig_application_date) : '\u2014'}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#7C818E] mb-0.5">Inspection Date</div>
                <div className="text-sm font-medium text-[#1A1D24]">
                  {application.ceig_inspection_date ? formatDate(application.ceig_inspection_date) : '\u2014'}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#7C818E] mb-0.5">Approval Date</div>
                <div className="text-sm font-medium text-[#1A1D24]">
                  {application.ceig_approval_date ? formatDate(application.ceig_approval_date) : '\u2014'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {application.notes && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Liaison Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#3F424D] whitespace-pre-wrap">{application.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-[#7C818E]">{label}</span>
      <span className={`font-medium text-[#1A1D24] ${mono ? 'font-mono' : ''}`}>
        {value || '\u2014'}
      </span>
    </div>
  );
}

function DiscomStatusBadge({ status }: { status: string }) {
  const variant = status === 'approved' || status === 'activated' ? 'success'
    : status === 'rejected' ? 'error'
    : status === 'submitted' || status === 'under_review' ? 'info'
    : 'pending';
  return <Badge variant={variant} className="capitalize">{status.replace(/_/g, ' ')}</Badge>;
}

function CeigStatusBadge({ status }: { status: string }) {
  const variant = status === 'approved' ? 'success'
    : status === 'rejected' ? 'error'
    : status === 'not_required' ? 'neutral'
    : 'pending';
  return <Badge variant={variant} className="capitalize">{status.replace(/_/g, ' ')}</Badge>;
}
