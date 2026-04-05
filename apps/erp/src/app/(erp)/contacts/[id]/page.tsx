import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContact, getContactEntities, getEntityActivities } from '@/lib/contacts-queries';
import { ActivityTimeline } from '@/components/contacts/activity-timeline';
import {
  Card, CardHeader, CardTitle, CardContent, Badge, Button,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Breadcrumb,
} from '@repo/ui';
import { Pencil } from 'lucide-react';

const LIFECYCLE_COLORS: Record<string, string> = {
  subscriber: '#7C818E',
  lead: '#2563EB',
  opportunity: '#EA580C',
  customer: '#00B050',
  evangelist: '#9333EA',
};

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [contact, entities, activities] = await Promise.all([
    getContact(id),
    getContactEntities(id),
    getEntityActivities('contact', id),
  ]);

  if (!contact) notFound();

  const stage = (contact as any).lifecycle_stage ?? 'lead';

  return (
    <div className="space-y-6">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Contacts', href: '/contacts' },
          { label: contact.name ?? 'Contact' },
        ]}
      />
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold text-[#1A1D24]">{contact.name}</h1>
            <Badge
              variant="neutral"
              className="text-[10px] capitalize"
              style={{
                color: LIFECYCLE_COLORS[stage] ?? '#7C818E',
                borderColor: `${LIFECYCLE_COLORS[stage] ?? '#7C818E'}30`,
                backgroundColor: `${LIFECYCLE_COLORS[stage] ?? '#7C818E'}10`,
              }}
            >
              {stage}
            </Badge>
          </div>
        </div>
        <Link href={`/contacts/${id}/edit`}>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Details + Activities */}
        <div className="col-span-2 space-y-6">
          {/* Person Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contact Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-[#7C818E]">First Name</span>
                  <p className="mt-0.5">{(contact as any).first_name ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">Last Name</span>
                  <p className="mt-0.5">{(contact as any).last_name ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">Phone</span>
                  <p className="font-mono mt-0.5">{contact.phone ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">Secondary Phone</span>
                  <p className="font-mono mt-0.5">{(contact as any).secondary_phone ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">Email</span>
                  <p className="mt-0.5">{contact.email ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">Designation</span>
                  <p className="mt-0.5">{contact.designation ?? '—'}</p>
                </div>
                {(contact as any).source && (
                  <div>
                    <span className="text-[#7C818E]">Source</span>
                    <p className="mt-0.5">{(contact as any).source}</p>
                  </div>
                )}
                {contact.notes && (
                  <div className="col-span-2">
                    <span className="text-[#7C818E]">Notes</span>
                    <p className="mt-0.5 whitespace-pre-wrap">{contact.notes}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Linked Entities */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Linked Leads / Proposals / Projects</CardTitle>
            </CardHeader>
            <CardContent>
              {entities.length === 0 ? (
                <p className="text-sm text-[#9CA0AB] py-4 text-center">Not linked to any entities yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Primary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entities.map((ec: any) => (
                      <TableRow key={ec.id}>
                        <TableCell>
                          <Link
                            href={`/${ec.entity_type}s/${ec.entity_id}`}
                            className="text-[#00B050] hover:underline font-medium capitalize"
                          >
                            {ec.entity_type}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{ec.role_label ?? '—'}</TableCell>
                        <TableCell>
                          {ec.is_primary && <Badge variant="success">Primary</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Activity Timeline */}
          <ActivityTimeline
            activities={activities}
            entityType="contact"
            entityId={id}
          />
        </div>

        {/* Right: Companies */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Companies</CardTitle>
            </CardHeader>
            <CardContent>
              {(!contact.contact_company_roles || contact.contact_company_roles.length === 0) ? (
                <p className="text-sm text-[#9CA0AB] py-4 text-center">No company affiliations.</p>
              ) : (
                <div className="space-y-3">
                  {contact.contact_company_roles.map((ccr: any) => (
                    <div key={ccr.id} className="rounded-md border border-[#DFE2E8] p-3">
                      <Link href={`/companies/${ccr.company_id}`} className="text-sm font-medium text-[#00B050] hover:underline">
                        {ccr.companies?.name}
                      </Link>
                      <p className="text-xs text-[#7C818E] mt-0.5">{ccr.role_title}</p>
                      {ccr.ended_at ? (
                        <Badge variant="neutral" className="mt-1 text-[9px]">Ended {ccr.ended_at}</Badge>
                      ) : (
                        <Badge variant="success" className="mt-1 text-[9px]">Active</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
