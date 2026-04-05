import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCompany, getEntityActivities } from '@/lib/contacts-queries';
import { ActivityTimeline } from '@/components/contacts/activity-timeline';
import {
  Card, CardHeader, CardTitle, CardContent, Badge, Button,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Breadcrumb,
} from '@repo/ui';
import { Pencil } from 'lucide-react';

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [company, activities] = await Promise.all([
    getCompany(id),
    getEntityActivities('company', id),
  ]);
  if (!company) notFound();

  const activeContacts = company.contact_company_roles?.filter((r: any) => !r.ended_at) ?? [];
  const pastContacts = company.contact_company_roles?.filter((r: any) => r.ended_at) ?? [];

  return (
    <div className="space-y-6">
      <Breadcrumb
        className="mb-4"
        items={[
          { label: 'Companies', href: '/companies' },
          { label: company.name },
        ]}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1D24] mt-1">{company.name}</h1>
        </div>
        <Link href={`/companies/${id}/edit`}>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          {/* Company Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Company Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-[#7C818E]">Segment</span>
                  <p className="mt-0.5 capitalize">{company.segment}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">GSTIN</span>
                  <p className="font-mono mt-0.5">{company.gstin ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">PAN</span>
                  <p className="font-mono mt-0.5">{(company as any).pan ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">Industry</span>
                  <p className="mt-0.5">{(company as any).industry ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">City</span>
                  <p className="mt-0.5">{company.city ?? '—'}</p>
                </div>
                <div>
                  <span className="text-[#7C818E]">State</span>
                  <p className="mt-0.5">{company.state ?? '—'}</p>
                </div>
                {company.address_line1 && (
                  <div className="col-span-2">
                    <span className="text-[#7C818E]">Address</span>
                    <p className="mt-0.5">{company.address_line1}{company.address_line2 ? `, ${company.address_line2}` : ''}{company.pincode ? ` - ${company.pincode}` : ''}</p>
                  </div>
                )}
                {company.website && (
                  <div>
                    <span className="text-[#7C818E]">Website</span>
                    <p className="mt-0.5 text-[#00B050]">{company.website}</p>
                  </div>
                )}
                {(company as any).company_size && (
                  <div>
                    <span className="text-[#7C818E]">Company Size</span>
                    <p className="mt-0.5 capitalize">{(company as any).company_size}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Active Contacts */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">People at {company.name}</CardTitle>
            </CardHeader>
            <CardContent>
              {activeContacts.length === 0 ? (
                <p className="text-sm text-[#9CA0AB] py-4 text-center">No contacts linked yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Email</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeContacts.map((ccr: any) => (
                      <TableRow key={ccr.id}>
                        <TableCell>
                          <Link href={`/contacts/${ccr.contacts?.id}`} className="text-[#00B050] hover:underline font-medium">
                            {ccr.contacts?.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{ccr.role_title}</TableCell>
                        <TableCell className="font-mono text-sm">{ccr.contacts?.phone ?? '—'}</TableCell>
                        <TableCell className="text-sm">{ccr.contacts?.email ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Past Contacts */}
          {pastContacts.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-[#7C818E]">Past Contacts</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Ended</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pastContacts.map((ccr: any) => (
                      <TableRow key={ccr.id}>
                        <TableCell>
                          <Link href={`/contacts/${ccr.contacts?.id}`} className="text-[#00B050] hover:underline font-medium">
                            {ccr.contacts?.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">{ccr.role_title}</TableCell>
                        <TableCell className="text-sm text-[#7C818E]">{ccr.ended_at}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Activity Timeline */}
          <ActivityTimeline
            activities={activities}
            entityType="company"
            entityId={id}
          />
        </div>

        {/* Right sidebar */}
        <div>
          {company.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[#3F424D] whitespace-pre-wrap">{company.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
