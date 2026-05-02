import { notFound } from 'next/navigation';
import { getLead } from '@/lib/leads-queries';
import { getEntityContacts } from '@/lib/contacts-queries';
import { EntityContactsCard } from '@/components/contacts/entity-contacts-card';
import { formatDate, toIST } from '@repo/ui/formatters';
import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';

interface LeadDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailsTab({ params }: LeadDetailPageProps) {
  const { id } = await params;
  const [lead, entityContacts] = await Promise.all([
    getLead(id),
    getEntityContacts('lead', id),
  ]);

  if (!lead) {
    notFound();
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Main content */}
      <div className="col-span-2 space-y-6">
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
            <InfoRow label="Expected Close" value={lead.expected_close_date ? formatDate(lead.expected_close_date) : null} />
            <InfoRow label="Probability" value={lead.close_probability != null && lead.close_probability > 0 ? `${lead.close_probability}%` : null} />
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
              <p className="text-sm text-n-700 whitespace-pre-wrap">{lead.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Sidebar */}
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
            {lead.map_link && (
              <div className="flex justify-between text-sm">
                <span className="text-n-500">Site location</span>
                <a
                  href={lead.map_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-p-600 hover:underline font-medium"
                >
                  View on map ↗
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        <EntityContactsCard entityType="lead" entityId={id} contacts={entityContacts} />
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
      <span className="text-n-500">{label}</span>
      <span className={`text-n-900 ${mono ? 'font-mono' : ''} ${cap ? 'capitalize' : ''}`}>
        {value}
      </span>
    </div>
  );
}
