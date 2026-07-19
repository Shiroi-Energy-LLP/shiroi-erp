import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContact, getContactEntities, getEntityActivities } from '@/lib/contacts-queries';
import { ActivityTimeline } from '@/components/contacts/activity-timeline';
import { EndRoleButton } from '@/components/contacts/end-role-button';
import {
  Card, CardHeader, CardTitle, CardContent, Badge, Button,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Breadcrumb, EmptyState,
} from '@repo/ui';
import { Pencil, Building2 } from 'lucide-react';

const LIFECYCLE_COLORS: Record<string, string> = {
  subscriber: '#7C818E',
  lead: '#2563EB',
  opportunity: '#EA580C',
  customer: '#16A34A',
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
            <h1 className="text-2xl font-bold text-n-950">{contact.name}</h1>
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
                  <span className="text-n-500">First Name</span>
                  <p className="mt-0.5">{(contact as any).first_name ?? '—'}</p>
                </div>
                <div>
                  <span className="text-n-500">Last Name</span>
                  <p className="mt-0.5">{(contact as any).last_name ?? '—'}</p>
                </div>
                <div>
                  <span className="text-n-500">Phone</span>
                  <p className="font-mono mt-0.5">{contact.phone ?? '—'}</p>
                </div>
                <div>
                  <span className="text-n-500">Secondary Phone</span>
                  <p className="font-mono mt-0.5">{(contact as any).secondary_phone ?? '—'}</p>
                </div>
                <div>
                  <span className="text-n-500">Email</span>
                  <p className="mt-0.5">{contact.email ?? '—'}</p>
                </div>
                <div>
                  <span className="text-n-500">Designation</span>
                  <p className="mt-0.5">{contact.designation ?? '—'}</p>
                </div>
                {(contact as any).source && (
                  <div>
                    <span className="text-n-500">Source</span>
                    <p className="mt-0.5">{(contact as any).source}</p>
                  </div>
                )}
                {contact.notes && (
                  <div className="col-span-2">
                    <span className="text-n-500">Notes</span>
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
                <p className="text-sm text-n-400 py-4 text-center">Not linked to any entities yet.</p>
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
                            className="text-shiroi-gold-dark hover:underline font-medium capitalize"
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
                <EmptyState
                  icon={<Building2 className="h-12 w-12" />}
                  title="No company affiliations"
                  description="This contact is not linked to any company yet."
                />
              ) : (
                <div className="space-y-3">
                  {contact.contact_company_roles.map((ccr: any) => (
                    <div key={ccr.id} className="rounded-md border border-n-200 p-3">
                      <Link href={`/companies/${ccr.company_id}`} className="text-sm font-medium text-shiroi-gold-dark hover:underline">
                        {ccr.companies?.name}
                      </Link>
                      <p className="text-xs text-n-500 mt-0.5">{ccr.role_title}</p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        {ccr.ended_at ? (
                          <Badge variant="neutral" className="text-[9px]">Ended {ccr.ended_at}</Badge>
                        ) : (
                          <Badge variant="success" className="text-[9px]">Active</Badge>
                        )}
                        {!ccr.ended_at && (
                          <EndRoleButton
                            roleId={ccr.id}
                            roleTitle={ccr.role_title}
                            companyName={ccr.companies?.name ?? 'this company'}
                          />
                        )}
                      </div>
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
