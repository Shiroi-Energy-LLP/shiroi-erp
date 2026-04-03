import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLead, getLeadActivities } from '@/lib/leads-queries';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { ActivityFeed } from '@/components/leads/activity-feed';
import { StatusChange } from '@/components/leads/status-change';
import { AddActivityForm } from '@/components/leads/add-activity-form';
import { toIST, formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
} from '@repo/ui';
import { QuickQuoteButton } from '@/components/proposals/quick-quote-button';

interface LeadDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailPage({ params }: LeadDetailPageProps) {
  const { id } = await params;
  const [lead, activities] = await Promise.all([
    getLead(id),
    getLeadActivities(id),
  ]);

  if (!lead) {
    notFound();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link href="/leads" className="text-sm text-muted-foreground hover:text-[#00B050]">
              Leads
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-2xl font-bold text-[#1A1D24]">{lead.customer_name}</h1>
          </div>
          <div className="flex items-center gap-3">
            <LeadStatusBadge status={lead.status} />
            {lead.employees?.full_name && (
              <span className="text-sm text-muted-foreground">
                Assigned to {lead.employees.full_name}
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              Created {toIST(lead.created_at)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <QuickQuoteButton
            leadId={lead.id}
            systemType={lead.system_type}
            sizeKwp={lead.estimated_size_kwp}
            segment={lead.segment}
          />
          <StatusChange leadId={lead.id} currentStatus={lead.status} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Activity feed */}
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Activity History</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ActivityFeed activities={activities} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <AddActivityForm leadId={lead.id} />
            </CardContent>
          </Card>
        </div>

        {/* Right: Lead info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="Phone" value={lead.phone} mono />
              <InfoRow label="Email" value={lead.email} />
              <InfoRow label="City" value={lead.city} />
              <InfoRow label="State" value={lead.state} />
              {lead.pincode && <InfoRow label="Pincode" value={lead.pincode} />}
              {lead.address_line1 && <InfoRow label="Address" value={lead.address_line1} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lead Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow label="Segment" value={lead.segment} capitalize />
              <InfoRow label="Source" value={lead.source?.replace(/_/g, ' ')} capitalize />
              {lead.system_type && (
                <InfoRow label="System Type" value={lead.system_type.replace(/_/g, ' ')} capitalize />
              )}
              {lead.estimated_size_kwp && (
                <InfoRow label="Est. Size" value={`${lead.estimated_size_kwp} kWp`} />
              )}
              {lead.next_followup_date && (
                <InfoRow label="Next Follow-up" value={formatDate(lead.next_followup_date)} />
              )}
              {lead.last_contacted_at && (
                <InfoRow label="Last Contacted" value={toIST(lead.last_contacted_at)} />
              )}
            </CardContent>
          </Card>

          {lead.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[#3E3E3E] whitespace-pre-wrap">{lead.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
  capitalize: cap,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  capitalize?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-[#1A1D24] ${mono ? 'font-mono' : ''} ${cap ? 'capitalize' : ''}`}>
        {value}
      </span>
    </div>
  );
}
