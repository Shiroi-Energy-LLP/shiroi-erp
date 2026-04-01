import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import { getStepDetailsData } from '@/lib/project-stepper-queries';

interface StepDetailsProps {
  projectId: string;
}

export async function StepDetails({ projectId }: StepDetailsProps) {
  const { project, cashPosition } = await getStepDetailsData(projectId);

  const location = [project.site_address_line1, project.site_address_line2, project.site_city, project.site_state, project.site_pincode]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Client Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Client Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InfoRow label="Customer" value={project.customer_name} />
          <InfoRow label="Phone" value={project.customer_phone} mono />
          {project.customer_email && (
            <InfoRow label="Email" value={project.customer_email} />
          )}
          <InfoRow label="Project Number" value={project.project_number} mono />
          <InfoRow label="Status" value={project.status.replace(/_/g, ' ')} capitalize />
          <InfoRow label="Location" value={location} />
        </CardContent>
      </Card>

      {/* Technical Specs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Technical Specs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InfoRow label="System Size" value={`${project.system_size_kwp} kWp`} />
          <InfoRow label="System Type" value={project.system_type.replace(/_/g, ' ')} capitalize />
          <InfoRow label="Structure" value={project.structure_type} />
          <InfoRow label="Panels" value={formatEquipment(project.panel_brand, project.panel_model, project.panel_wattage ? `${project.panel_wattage}W` : null)} />
          <InfoRow label="Panel Count" value={project.panel_count?.toString()} />
          <InfoRow label="Inverter" value={formatEquipment(project.inverter_brand, project.inverter_model, project.inverter_capacity_kw ? `${project.inverter_capacity_kw} kW` : null)} />
          {project.system_type !== 'on_grid' && (
            <InfoRow label="Battery" value={formatEquipment(project.battery_brand, project.battery_model, project.battery_capacity_kwh ? `${project.battery_capacity_kwh} kWh` : null)} />
          )}
          <InfoRow label="Completion" value={`${project.completion_pct}%`} />
        </CardContent>
      </Card>

      {/* Financial Overview */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Financial Overview</CardTitle>
        </CardHeader>
        <CardContent>
          {cashPosition ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <FinanceItem label="Contracted Value" value={cashPosition.total_contracted} />
              <FinanceItem label="Total Invoiced" value={cashPosition.total_invoiced} />
              <FinanceItem label="Total Received" value={cashPosition.total_received} />
              <FinanceItem label="Total PO Value" value={cashPosition.total_po_value} />
              <FinanceItem label="Paid to Vendors" value={cashPosition.total_paid_to_vendors} />
              <FinanceItem
                label="Net Cash Position"
                value={cashPosition.net_cash_position}
                highlight={cashPosition.net_cash_position < 0 ? 'negative' : 'positive'}
              />
            </div>
          ) : (
            <p className="text-sm text-[#7C818E]">
              Contract value: {formatINR(project.contracted_value)}. Detailed cash position not yet computed.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value, mono, capitalize: cap }: { label: string; value: string | null | undefined; mono?: boolean; capitalize?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-[#7C818E]">{label}</span>
      <span className={`font-medium text-[#1A1D24] ${mono ? 'font-mono' : ''} ${cap ? 'capitalize' : ''}`}>
        {value || '\u2014'}
      </span>
    </div>
  );
}

function FinanceItem({ label, value, highlight }: { label: string; value: number; highlight?: 'positive' | 'negative' }) {
  return (
    <div>
      <div className="text-xs text-[#7C818E] mb-0.5">{label}</div>
      <div className={`text-sm font-mono font-medium ${highlight === 'negative' ? 'text-[#991B1B]' : highlight === 'positive' ? 'text-[#065F46]' : 'text-[#1A1D24]'}`}>
        {formatINR(value)}
      </div>
    </div>
  );
}

function formatEquipment(...parts: (string | null | undefined)[]): string {
  const filtered = parts.filter(Boolean);
  return filtered.length > 0 ? filtered.join(' ') : '\u2014';
}
