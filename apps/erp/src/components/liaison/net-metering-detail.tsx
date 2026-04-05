'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  updateCeigStatus, updateDiscomStatus, updateNetMeterInstallation, recordFollowup,
} from '@/lib/liaison-actions';
import {
  Card, CardHeader, CardTitle, CardContent, Button, Input, Select, Label, Badge,
} from '@repo/ui';
import { Shield, Zap, Gauge, Calendar, AlertTriangle, CheckCircle2 } from 'lucide-react';

const CEIG_STATUSES = [
  { value: 'not_applicable', label: 'Not Applicable' },
  { value: 'pending', label: 'Pending' },
  { value: 'applied', label: 'Applied' },
  { value: 'inspection_scheduled', label: 'Inspection Scheduled' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'reapplied', label: 'Re-Applied' },
];

const DISCOM_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'applied', label: 'Applied' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'site_inspection_scheduled', label: 'Site Inspection Scheduled' },
  { value: 'approved', label: 'Approved' },
  { value: 'net_meter_installed', label: 'Net Meter Installed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'objection_raised', label: 'Objection Raised' },
];

interface NetMeteringDetailProps {
  projectId: string;
  application: {
    ceig_status: string;
    ceig_application_date: string | null;
    ceig_inspection_date: string | null;
    ceig_approval_date: string | null;
    ceig_certificate_number: string | null;
    ceig_rejection_reason: string | null;
    discom_name: string;
    discom_status: string;
    discom_application_date: string | null;
    discom_application_number: string | null;
    net_meter_installed: boolean;
    net_meter_installed_date: string | null;
    net_meter_serial_number: string | null;
    last_followup_date: string | null;
    next_followup_date: string | null;
    followup_count: number;
    notes: string | null;
  };
  ceigRequired: boolean;
}

export function NetMeteringDetail({ projectId, application, ceigRequired }: NetMeteringDetailProps) {
  const router = useRouter();
  const [saving, setSaving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleCeigUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving('ceig');
    setError(null);
    const form = new FormData(e.currentTarget);

    const res = await updateCeigStatus({
      projectId,
      ceigStatus: form.get('ceigStatus') as string,
      ceigApplicationDate: form.get('ceigApplicationDate') as string || undefined,
      ceigInspectionDate: form.get('ceigInspectionDate') as string || undefined,
      ceigApprovalDate: form.get('ceigApprovalDate') as string || undefined,
      ceigCertificateNumber: form.get('ceigCertificateNumber') as string || undefined,
      ceigRejectionReason: form.get('ceigRejectionReason') as string || undefined,
    });

    setSaving(null);
    if (res.success) {
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to update');
    }
  }

  async function handleDiscomUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving('discom');
    setError(null);
    const form = new FormData(e.currentTarget);

    const res = await updateDiscomStatus({
      projectId,
      discomStatus: form.get('discomStatus') as string,
      discomApplicationDate: form.get('discomApplicationDate') as string || undefined,
      discomApplicationNumber: form.get('discomApplicationNumber') as string || undefined,
      notes: form.get('notes') as string || undefined,
    });

    setSaving(null);
    if (res.success) {
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to update');
    }
  }

  async function handleNetMeterUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving('netmeter');
    setError(null);
    const form = new FormData(e.currentTarget);

    const res = await updateNetMeterInstallation({
      projectId,
      netMeterInstalled: form.get('netMeterInstalled') === 'true',
      netMeterInstalledDate: form.get('netMeterInstalledDate') as string || undefined,
      netMeterSerialNumber: form.get('netMeterSerialNumber') as string || undefined,
    });

    setSaving(null);
    if (res.success) {
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to update');
    }
  }

  async function handleFollowup() {
    setSaving('followup');
    const nextDate = prompt('Enter next followup date (YYYY-MM-DD):');
    if (!nextDate) { setSaving(null); return; }
    const notes = prompt('Followup notes (optional):');

    const res = await recordFollowup({ projectId, nextFollowupDate: nextDate, notes: notes || undefined });
    setSaving(null);
    if (res.success) {
      router.refresh();
    } else {
      setError(res.error ?? 'Failed to record followup');
    }
  }

  const ceigBlocked = ceigRequired && application.ceig_status !== 'approved';

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CEIG Section */}
        {ceigRequired && (
          <Card className={application.ceig_status === 'approved' ? 'border-[#00B050]/30' : 'border-[#EA580C]/30'}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" />
                CEIG Clearance
                <Badge variant={application.ceig_status === 'approved' ? 'success' : application.ceig_status === 'rejected' ? 'error' : 'warning'} className="capitalize ml-auto">
                  {application.ceig_status.replace(/_/g, ' ')}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCeigUpdate} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Status</Label>
                    <Select name="ceigStatus" defaultValue={application.ceig_status} className="h-9 text-sm">
                      {CEIG_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Application Date</Label>
                    <Input name="ceigApplicationDate" type="date" defaultValue={application.ceig_application_date ?? ''} className="h-9 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Inspection Date</Label>
                    <Input name="ceigInspectionDate" type="date" defaultValue={application.ceig_inspection_date ?? ''} className="h-9 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Approval Date</Label>
                    <Input name="ceigApprovalDate" type="date" defaultValue={application.ceig_approval_date ?? ''} className="h-9 text-sm" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Certificate Number</Label>
                  <Input name="ceigCertificateNumber" defaultValue={application.ceig_certificate_number ?? ''} placeholder="CEIG certificate #" className="h-9 text-sm" />
                </div>
                {application.ceig_status === 'rejected' && (
                  <div className="space-y-1">
                    <Label className="text-xs">Rejection Reason</Label>
                    <Input name="ceigRejectionReason" defaultValue={application.ceig_rejection_reason ?? ''} className="h-9 text-sm" />
                  </div>
                )}
                <Button type="submit" size="sm" disabled={saving === 'ceig'}>
                  {saving === 'ceig' ? 'Saving...' : 'Update CEIG'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* DISCOM/TNEB Section */}
        <Card className={ceigBlocked ? 'border-[#DFE2E8] opacity-75' : ''}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" />
              {application.discom_name || 'TNEB'} Application
              <Badge variant={
                application.discom_status === 'approved' || application.discom_status === 'net_meter_installed' ? 'success' :
                application.discom_status === 'rejected' || application.discom_status === 'objection_raised' ? 'error' : 'warning'
              } className="capitalize ml-auto">
                {application.discom_status.replace(/_/g, ' ')}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ceigBlocked && (
              <div className="flex items-center gap-2 rounded-md bg-[#FFFBEB] border border-[#FDE68A] px-3 py-2 text-xs text-[#92400E] mb-3">
                <Shield className="h-3.5 w-3.5 flex-shrink-0" />
                CEIG clearance required before TNEB submission can proceed.
              </div>
            )}
            <form onSubmit={handleDiscomUpdate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select name="discomStatus" defaultValue={application.discom_status} className="h-9 text-sm">
                    {DISCOM_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Application Date</Label>
                  <Input name="discomApplicationDate" type="date" defaultValue={application.discom_application_date ?? ''} className="h-9 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Application Number</Label>
                <Input name="discomApplicationNumber" defaultValue={application.discom_application_number ?? ''} placeholder="TNEB application #" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Input name="notes" defaultValue={application.notes ?? ''} placeholder="Any additional notes..." className="h-9 text-sm" />
              </div>
              <Button type="submit" size="sm" disabled={saving === 'discom'}>
                {saving === 'discom' ? 'Saving...' : 'Update DISCOM'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Net Meter Installation */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="h-4 w-4" />
              Net Meter
              {application.net_meter_installed && <CheckCircle2 className="h-4 w-4 text-[#00B050] ml-auto" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleNetMeterUpdate} className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Installed?</Label>
                <Select name="netMeterInstalled" defaultValue={String(application.net_meter_installed)} className="h-9 text-sm">
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Installation Date</Label>
                  <Input name="netMeterInstalledDate" type="date" defaultValue={application.net_meter_installed_date ?? ''} className="h-9 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Serial Number</Label>
                  <Input name="netMeterSerialNumber" defaultValue={application.net_meter_serial_number ?? ''} placeholder="Meter serial #" className="h-9 text-sm" />
                </div>
              </div>
              <Button type="submit" size="sm" disabled={saving === 'netmeter'}>
                {saving === 'netmeter' ? 'Saving...' : 'Update Net Meter'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Followup Tracking */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Followup Tracking
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-[#7C818E] text-xs">Last Followup</span>
                <p className="font-mono">{application.last_followup_date ?? '—'}</p>
              </div>
              <div>
                <span className="text-[#7C818E] text-xs">Next Followup</span>
                <p className="font-mono">{application.next_followup_date ?? '—'}</p>
              </div>
              <div>
                <span className="text-[#7C818E] text-xs">Total Followups</span>
                <p className="font-mono">{application.followup_count}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleFollowup} disabled={saving === 'followup'}>
              {saving === 'followup' ? 'Recording...' : 'Record Followup'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
