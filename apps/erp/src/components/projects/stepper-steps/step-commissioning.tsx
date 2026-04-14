import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { formatDate } from '@repo/ui/formatters';
import { createClient } from '@repo/supabase/server';
import { getStepCommissioningData } from '@/lib/project-stepper-queries';
import { getProjectForCommissioning } from '@/lib/project-step-actions';
import { Zap, Check, ExternalLink } from 'lucide-react';
import { CommissioningForm } from '@/components/projects/forms/commissioning-form';
import { CommissioningPdfButton, FinalizeButton } from '@/components/projects/forms/commissioning-controls';
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
        <h3 className="text-sm font-semibold text-n-700 mb-1">Failed to Load</h3>
        <p className="text-xs text-n-500">Could not load commissioning data. Please refresh the page.</p>
      </div>
    );
  }

  const defaults = {
    system_size_kwp: projectInfo?.system_size_kwp ?? 0,
    panel_count: projectInfo?.panel_count ?? 0,
    inverter_brand: projectInfo?.inverter_brand ?? null,
    inverter_model: projectInfo?.inverter_model ?? null,
  };

  // No report yet
  if (!report) {
    return (
      <div>
        <CommissioningForm projectId={projectId} defaults={defaults} />
        <div className="flex flex-col items-center justify-center py-12">
          <Zap className="w-12 h-12 text-n-300 mb-3" />
          <h3 className="text-sm font-semibold text-n-700 mb-1">No Commissioning Report</h3>
          <p className="text-xs text-n-500">
            Click &quot;Create Commissioning Report&quot; above to record commissioning data.
          </p>
        </div>
      </div>
    );
  }

  const r = report as any;
  const irLow = r.insulation_resistance_mohm !== null && Number(r.insulation_resistance_mohm) < 0.5;
  const isFinalized = r.status === 'finalized' || r.status === 'submitted';
  const isDraft = r.status === 'draft';
  const rawStringTests = (r.string_test_data ?? []) as Array<{
    inverter_no: string;
    string_no: string;
    vmp: string | number;
    isc: string | number;
    polarity_ok: boolean;
  }>;
  // Coerce vmp/isc to strings for form compatibility
  const stringTests = rawStringTests.map((row) => ({
    ...row,
    vmp: String(row.vmp ?? ''),
    isc: String(row.isc ?? ''),
  }));

  // Build editable report for edit mode
  const editableReport = {
    id: r.id,
    commissioning_date: r.commissioning_date,
    system_size_kwp: r.system_size_kwp,
    panel_count_installed: r.panel_count_installed,
    inverter_serial_number: r.inverter_serial_number,
    initial_reading_kwh: r.initial_reading_kwh,
    dc_voltage_v: r.dc_voltage_v,
    dc_current_a: r.dc_current_a,
    ac_voltage_v: r.ac_voltage_v,
    ac_frequency_hz: r.ac_frequency_hz,
    earth_resistance_ohm: r.earth_resistance_ohm,
    insulation_resistance_mohm: r.insulation_resistance_mohm,
    generation_confirmed: r.generation_confirmed,
    customer_explained: r.customer_explained,
    app_download_assisted: r.app_download_assisted,
    notes: r.notes,
    status: r.status,
    string_test_data: stringTests,
    monitoring_portal_link: r.monitoring_portal_link,
    monitoring_login: r.monitoring_login,
    monitoring_password: r.monitoring_password,
    performance_ratio_pct: r.performance_ratio_pct,
  };

  return (
    <div className="space-y-6">
      {/* Status banner */}
      {isFinalized ? (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100">
            <Check className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <div className="text-sm font-semibold text-green-800">Commissioning Complete</div>
            <div className="text-xs text-green-700">
              Commissioned on {formatDate(r.commissioning_date)}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <CommissioningPdfButton projectId={projectId} />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <CommissioningForm
              projectId={projectId}
              defaults={defaults}
              existingReport={editableReport}
            />
            <CommissioningPdfButton projectId={projectId} />
          </div>
          {isDraft && (
            <FinalizeButton projectId={projectId} reportId={r.id} />
          )}
        </div>
      )}

      {/* Continue to AMC */}
      <div className="flex justify-end">
        <Link href={`/projects/${projectId}?tab=amc`}>
          <span className="text-xs text-p-600 hover:text-p-700 cursor-pointer">
            Continue to AMC →
          </span>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Commissioning Info card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-n-500">
              Commissioning Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <InfoRow label="Date" value={formatDate(r.commissioning_date)} />
            <InfoRow label="System Size" value={`${r.system_size_kwp} kWp`} />
            <InfoRow label="Panels Installed" value={String(r.panel_count_installed)} />
            <InfoRow label="Inverter S/N" value={r.inverter_serial_number} mono />
            <InfoRow label="Initial Reading" value={`${r.initial_reading_kwh} kWh`} />
            {r.performance_ratio_pct != null && (
              <InfoRow label="Performance Ratio" value={`${r.performance_ratio_pct}%`} />
            )}
            <div className="flex justify-between text-xs items-center">
              <span className="text-n-500">Status</span>
              <Badge
                variant={
                  isFinalized
                    ? 'success'
                    : r.status === 'draft'
                      ? 'warning'
                      : 'default'
                }
                className="capitalize text-[10px]"
              >
                {(r.status ?? 'draft').replace(/_/g, ' ')}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* System-Level Electrical Readings */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-n-500">
              Electrical Readings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <InfoRow label="DC Voltage" value={r.dc_voltage_v != null ? `${r.dc_voltage_v} V` : null} />
            <InfoRow label="DC Current" value={r.dc_current_a != null ? `${r.dc_current_a} A` : null} />
            <InfoRow label="AC Voltage" value={r.ac_voltage_v != null ? `${r.ac_voltage_v} V` : null} />
            <InfoRow label="AC Frequency" value={r.ac_frequency_hz != null ? `${r.ac_frequency_hz} Hz` : null} />
            <InfoRow label="Earth Resistance" value={r.earth_resistance_ohm != null ? `${r.earth_resistance_ohm} Ω` : null} />
            <div className="flex justify-between text-xs items-center">
              <span className="text-n-500">Insulation Resistance</span>
              <span className={`font-mono font-medium ${irLow ? 'text-red-700' : 'text-n-900'}`}>
                {r.insulation_resistance_mohm != null ? `${r.insulation_resistance_mohm} MΩ` : '—'}
              </span>
            </div>
            {irLow && (
              <div className="bg-red-50 border border-red-200 rounded-md p-2 text-[10px] text-red-700 font-medium">
                IR reading below 0.5 MΩ — Critical service ticket auto-created (4h SLA)
              </div>
            )}
          </CardContent>
        </Card>

        {/* String-Level Tests */}
        {stringTests.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-n-500">
                String-Level Electrical Tests
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-n-200 bg-n-50">
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">
                      Inverter No.
                    </th>
                    <th className="px-3 py-1.5 text-left text-[10px] font-medium text-n-500">
                      String No.
                    </th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-medium text-n-500">
                      Vmp (V)
                    </th>
                    <th className="px-3 py-1.5 text-right text-[10px] font-medium text-n-500">
                      Isc (A)
                    </th>
                    <th className="px-3 py-1.5 text-center text-[10px] font-medium text-n-500">
                      Polarity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stringTests.map((row, idx) => (
                    <tr key={idx} className="border-b border-n-50 last:border-b-0">
                      <td className="px-3 py-1.5">{row.inverter_no}</td>
                      <td className="px-3 py-1.5">{row.string_no}</td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {row.vmp || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">
                        {row.isc || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {row.polarity_ok ? (
                          <span className="text-green-700 font-semibold">OK</span>
                        ) : (
                          <span className="text-red-700 font-semibold">FAIL</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Monitoring Details */}
        {(r.monitoring_portal_link || r.monitoring_login) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-n-500">
                Monitoring Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {r.monitoring_portal_link && (
                <div className="flex justify-between text-xs items-center">
                  <span className="text-n-500">Portal</span>
                  <a
                    href={r.monitoring_portal_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-p-600 hover:text-p-700 inline-flex items-center gap-1"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {r.monitoring_login && <InfoRow label="Login" value={r.monitoring_login} mono />}
              {r.monitoring_password && <InfoRow label="Password" value={r.monitoring_password} mono />}
            </CardContent>
          </Card>
        )}

        {/* Customer Handover */}
        <Card className={r.monitoring_portal_link || r.monitoring_login ? '' : 'md:col-span-2'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-n-500">
              Customer Handover
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-6">
              <CheckItem label="Generation Confirmed" checked={r.generation_confirmed} />
              <CheckItem label="Customer Explained" checked={r.customer_explained} />
              <CheckItem label="App Download Assisted" checked={r.app_download_assisted} />
            </div>
          </CardContent>
        </Card>

        {/* Notes */}
        {r.notes && (
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-n-500">
                Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-n-600 whitespace-pre-wrap">{r.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-n-500">{label}</span>
      <span className={`font-medium text-n-900 ${mono ? 'font-mono' : ''}`}>
        {value || '—'}
      </span>
    </div>
  );
}

function CheckItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span
        className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
          checked ? 'bg-green-100 text-green-700' : 'bg-n-100 text-n-400'
        }`}
      >
        {checked ? '✓' : '✗'}
      </span>
      <span className={checked ? 'text-n-900' : 'text-n-400'}>{label}</span>
    </div>
  );
}
