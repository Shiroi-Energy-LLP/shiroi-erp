import { notFound } from 'next/navigation';
import { getProject } from '@/lib/projects-queries';
import { getEntityContacts } from '@/lib/contacts-queries';
import { EntityContactsCard } from '@/components/contacts/entity-contacts-card';
import { ProjectFiles } from '@/components/projects/project-files';
import { HandoverPack } from '@/components/projects/handover-pack';
import { getHandoverPack } from '@/lib/handover-actions';
import { formatINR, formatDate, toIST } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Breadcrumb,
} from '@repo/ui';

interface ProjectOverviewPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectOverviewPage({ params }: ProjectOverviewPageProps) {
  const { id } = await params;
  const [project, entityContacts, handoverPack] = await Promise.all([
    getProject(id),
    getEntityContacts('project', id),
    getHandoverPack(id),
  ]);

  if (!project) {
    notFound();
  }

  const milestones = project.project_milestones ?? [];
  const blockedMilestones = milestones.filter((m) => m.is_blocked);
  const activeMilestones = milestones.filter((m) => m.status === 'in_progress');

  return (
    <div className="space-y-6">
    <Breadcrumb
      className="mb-4"
      items={[
        { label: 'Projects', href: '/projects' },
        { label: project.project_number ?? project.customer_name },
      ]}
    />
    <div className="grid grid-cols-3 gap-6">
      {/* Left column: System + Timeline */}
      <div className="col-span-2 space-y-6">
        {/* System Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <InfoItem label="System Type" value={project.system_type.replace(/_/g, ' ')} capitalize />
              <InfoItem label="System Size" value={`${project.system_size_kwp} kWp`} />
              <InfoItem label="Structure" value={project.structure_type} />
              <InfoItem label="Panel" value={panelLabel(project)} />
              <InfoItem label="Inverter" value={inverterLabel(project)} />
              {project.system_type !== 'on_grid' && (
                <InfoItem label="Battery" value={batteryLabel(project)} />
              )}
              <InfoItem label="Panel Count" value={project.panel_count?.toString()} />
            </div>
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <InfoItem label="Planned Start" value={project.planned_start_date ? formatDate(project.planned_start_date) : null} />
              <InfoItem label="Planned End" value={project.planned_end_date ? formatDate(project.planned_end_date) : null} />
              <InfoItem label="Actual Start" value={project.actual_start_date ? formatDate(project.actual_start_date) : null} />
              <InfoItem label="Actual End" value={project.actual_end_date ? formatDate(project.actual_end_date) : null} />
              <InfoItem label="Commissioned" value={project.commissioned_date ? formatDate(project.commissioned_date) : null} />
              <InfoItem label="Advance Received" value={formatDate(project.advance_received_at)} />
            </div>
          </CardContent>
        </Card>

        {/* Site Address */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Site Address</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm text-[#3E3E3E]">
              <p>{project.site_address_line1}</p>
              {project.site_address_line2 && <p>{project.site_address_line2}</p>}
              <p>{project.site_city}, {project.site_state} {project.site_pincode}</p>
              {project.site_latitude && project.site_longitude && (
                <p className="text-xs text-muted-foreground mt-1">
                  {project.site_latitude}, {project.site_longitude}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* CEIG Gate (if applicable) */}
        {project.ceig_required && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">CEIG Clearance Gate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                {project.ceig_cleared ? (
                  <>
                    <Badge variant="success">Cleared</Badge>
                    <span className="text-sm text-muted-foreground">
                      {project.ceig_cleared_at ? formatDate(project.ceig_cleared_at) : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <Badge variant="warning">Pending</Badge>
                    <span className="text-sm text-[#9A3412]">
                      Net metering submission is blocked until CEIG clearance is approved (DB trigger enforced).
                    </span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Builder Scope (if applicable) */}
        {project.has_builder_scope && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Builder Scope</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <InfoItem label="Builder" value={project.builder_name} />
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Civil Cleared</div>
                  {project.builder_civil_cleared ? (
                    <Badge variant="success">Yes</Badge>
                  ) : (
                    <Badge variant="warning">No</Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right column */}
      <div className="space-y-6">
        {/* Financials */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Financials</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Contracted Value</span>
              <span className="font-mono font-medium">{formatINR(project.contracted_value)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Advance Received</span>
              <span className="font-mono">{formatINR(project.advance_amount)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Customer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{project.customer_name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Phone</span>
              <span className="font-mono">{project.customer_phone}</span>
            </div>
            {project.customer_email && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Email</span>
                <span>{project.customer_email}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Team */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Project Manager</span>
              <span>{project.employees?.full_name ?? '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Site Supervisor</span>
              <span>{project.pm_supervisor?.full_name ?? '—'}</span>
            </div>
          </CardContent>
        </Card>

        {/* Active Milestones Summary */}
        {activeMilestones.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active Milestones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeMilestones.map((m) => (
                <div key={m.id} className="flex justify-between text-sm">
                  <span>{m.milestone_name}</span>
                  <span className="font-mono text-muted-foreground">{m.completion_pct}%</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Blocked Milestones Alert */}
        {blockedMilestones.length > 0 && (
          <Card className="border-[#991B1B]">
            <CardHeader>
              <CardTitle className="text-base text-[#991B1B]">Blocked Milestones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {blockedMilestones.map((m) => (
                <div key={m.id} className="text-sm">
                  <div className="font-medium">{m.milestone_name}</div>
                  <div className="text-[#991B1B] text-xs">{m.blocked_reason ?? 'No reason specified'}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        {project.notes && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[#3E3E3E] whitespace-pre-wrap">{project.notes}</p>
            </CardContent>
          </Card>
        )}

        <HandoverPack projectId={id} existingPack={handoverPack as any} />

        <ProjectFiles projectId={id} />

        <EntityContactsCard entityType="project" entityId={id} contacts={entityContacts} />
      </div>
    </div>
    </div>
  );
}

function InfoItem({ label, value, capitalize: cap }: { label: string; value: string | null | undefined; capitalize?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-medium text-[#1A1D24] ${cap ? 'capitalize' : ''}`}>
        {value || '—'}
      </div>
    </div>
  );
}

function panelLabel(p: { panel_brand: string | null; panel_model: string | null; panel_wattage: number | null }): string {
  const parts: string[] = [];
  if (p.panel_brand) parts.push(p.panel_brand);
  if (p.panel_model) parts.push(p.panel_model);
  if (p.panel_wattage) parts.push(`${p.panel_wattage}W`);
  return parts.length > 0 ? parts.join(' ') : '—';
}

function inverterLabel(p: { inverter_brand: string | null; inverter_model: string | null; inverter_capacity_kw: number | null }): string {
  const parts: string[] = [];
  if (p.inverter_brand) parts.push(p.inverter_brand);
  if (p.inverter_model) parts.push(p.inverter_model);
  if (p.inverter_capacity_kw) parts.push(`${p.inverter_capacity_kw} kW`);
  return parts.length > 0 ? parts.join(' ') : '—';
}

function batteryLabel(p: { battery_brand: string | null; battery_model: string | null; battery_capacity_kwh: number | null }): string {
  const parts: string[] = [];
  if (p.battery_brand) parts.push(p.battery_brand);
  if (p.battery_model) parts.push(p.battery_model);
  if (p.battery_capacity_kwh) parts.push(`${p.battery_capacity_kwh} kWh`);
  return parts.length > 0 ? parts.join(' ') : '—';
}
