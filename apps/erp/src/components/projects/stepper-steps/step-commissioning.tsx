import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { getStepCommissioningData } from '@/lib/project-stepper-queries';
import { getProjectForCommissioning } from '@/lib/project-step-actions';
import { Zap } from 'lucide-react';
import { CommissioningForm } from '@/components/projects/forms/commissioning-form';
import Link from 'next/link';

interface StepCommissioningProps {
  projectId: string;
}

export async function StepCommissioning({ projectId }: StepCommissioningProps) {
  let report: Awaited<ReturnType<typeof getStepCommissioningData>> = null;
  let projectInfo: Awaited<ReturnType<typeof getProjectForCommissioning>> = null;

  try {
    [report, projectInfo] = await Promise.all([
      getStepCommissioningData(projectId),
      getProjectForCommissioning(projectId),
    ]);
  } catch (error) {
    console.error('[StepCommissioning] Failed to load data:', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Zap className="w-12 h-12 text-red-400 opacity-50 mb-3" />
        <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">Failed to Load</h3>
        <p className="text-[13px] text-[#7C818E]">Could not load commissioning data. Please refresh the page.</p>
      </div>
    );
  }

  const defaults = {
    system_size_kwp: projectInfo?.system_size_kwp ?? 0,
    panel_count: projectInfo?.panel_count ?? 0,
    inverter_brand: projectInfo?.inverter_brand ?? null,
    inverter_model: projectInfo?.inverter_model ?? null,
  };

  // Only show creation form if no report exists
  if (!report) {
    return (
      <div>
        <CommissioningForm projectId={projectId} defaults={defaults} />
        <div className="flex flex-col items-center justify-center py-16">
          <Zap className="w-12 h-12 text-[#7C818E] opacity-50 mb-3" />
          <h3 className="text-lg font-bold font-heading text-[#1A1D24] mb-1">No Commissioning Report</h3>
          <p className="text-[13px] text-[#7C818E]">Click &quot;Create Commissioning Report&quot; above to record commissioning data.</p>
        </div>
      </div>
    );
  }

  const irLow = report.insulation_resistance_mohm !== null && report.insulation_resistance_mohm < 0.5;

  // Prepare existing report data for the edit form
  const editableReport = {
    id: report.id,
    commissioning_date: report.commissioning_date,
    system_size_kwp: report.system_size_kwp,
    panel_count_installed: report.panel_count_installed,
    inverter_serial_number: report.inverter_serial_number,
    initial_reading_kwh: report.initial_reading_kwh,
    dc_voltage_v: report.dc_voltage_v,
    dc_current_a: report.dc_current_a,
    ac_voltage_v: report.ac_voltage_v,
    ac_frequency_hz: report.ac_frequency_hz,
    earth_resistance_ohm: report.earth_resistance_ohm,
    insulation_resistance_mohm: report.insulation_resistance_mohm,
    generation_confirmed: report.generation_confirmed,
    customer_explained: report.customer_explained,
    app_download_assisted: report.app_download_assisted,
    notes: report.notes,
    status: report.status,
  };

  return (
    <div className="space-y-6">
      {/* Edit form (collapsed by default) */}
      <CommissioningForm
        projectId={projectId}
        defaults={defaults}
        existingReport={editableReport}
      />

      <div className="flex justify-end">
        <Link href={`/projects/${projectId}?tab=amc`}>
          <Button size="sm" variant="ghost" className="text-xs">
            Continue to AMC →
          </Button>
        </Link>
      </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Commissioning Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Commissioning Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InfoRow label="Date" value={formatDate(report.commissioning_date)} />
          <InfoRow label="System Size" value={`${report.system_size_kwp} kWp`} />
          <InfoRow label="Panels Installed" value={report.panel_count_installed.toString()} />
          <InfoRow label="Inverter S/N" value={report.inverter_serial_number} mono />
          <InfoRow label="Initial Reading" value={`${report.initial_reading_kwh} kWh`} />
          <div className="flex justify-between text-sm items-center">
            <span className="text-[#7C818E]">Status</span>
            <Badge variant={report.status === 'signed' ? 'success' : report.status === 'draft' ? 'pending' : 'info'} className="capitalize">
              {report.status.replace(/_/g, ' ')}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Electrical Readings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Electrical Readings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InfoRow label="DC Voltage" value={report.dc_voltage_v !== null ? `${report.dc_voltage_v} V` : null} />
          <InfoRow label="DC Current" value={report.dc_current_a !== null ? `${report.dc_current_a} A` : null} />
          <InfoRow label="AC Voltage" value={report.ac_voltage_v !== null ? `${report.ac_voltage_v} V` : null} />
          <InfoRow label="AC Frequency" value={report.ac_frequency_hz !== null ? `${report.ac_frequency_hz} Hz` : null} />
          <InfoRow label="Earth Resistance" value={report.earth_resistance_ohm !== null ? `${report.earth_resistance_ohm} \u03A9` : null} />

          <div className="flex justify-between text-sm items-center">
            <span className="text-[#7C818E]">Insulation Resistance</span>
            <span className={`font-mono font-medium ${irLow ? 'text-[#991B1B]' : 'text-[#1A1D24]'}`}>
              {report.insulation_resistance_mohm !== null
                ? `${report.insulation_resistance_mohm} M\u03A9`
                : '\u2014'}
            </span>
          </div>
          {irLow && (
            <div className="bg-[#FEF2F2] border border-[#991B1B] rounded-md p-3 text-xs text-[#991B1B] font-medium">
              IR reading is below 0.5 M\u03A9. A critical service ticket has been auto-created (4h SLA).
            </div>
          )}
        </CardContent>
      </Card>

      {/* Customer Handover Checklist */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Customer Handover</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-6">
            <CheckItem label="Generation Confirmed" checked={report.generation_confirmed} />
            <CheckItem label="Customer Explained" checked={report.customer_explained} />
            <CheckItem label="App Download Assisted" checked={report.app_download_assisted} />
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      {report.notes && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[#3F424D] whitespace-pre-wrap">{report.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
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

function CheckItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${checked ? 'bg-[#ECFDF5] text-[#065F46]' : 'bg-[#F3F4F6] text-[#7C818E]'}`}>
        {checked ? '\u2713' : '\u2717'}
      </span>
      <span className={checked ? 'text-[#1A1D24]' : 'text-[#7C818E]'}>{label}</span>
    </div>
  );
}
