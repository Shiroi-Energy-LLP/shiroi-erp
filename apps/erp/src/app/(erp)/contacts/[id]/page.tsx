import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContact, getContactEntities } from '@/lib/contacts-queries';
import {
  Card, CardHeader, CardTitle, CardContent, Badge,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [contact, entities] = await Promise.all([
    getContact(id),
    getContactEntities(id),
  ]);

  if (!contact) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/contacts" className="text-sm text-[#00B050] hover:underline">&larr; Back to Contacts</Link>
        <h1 className="text-2xl font-bold text-[#1A1D24] mt-1">{contact.name}</h1>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Details */}
        <div className="col-span-2 space-y-6">
          {/* Person Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contact Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-[#7C818E]">Phone</span>
                  <p className="font-mono mt-0.5">{contact.phone ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">Email</span>
                  <p className="mt-0.5">{contact.email ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">Designation</span>
                  <p className="mt-0.5">{contact.designation ?? '—'}</p>
                </div>
                {contact.notes && (
                  <div className="col-span-2">
                    <span className="text-[#7C818E]">Notes</span>
                    <p className="mt-0.5">{contact.notes}</p>
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
