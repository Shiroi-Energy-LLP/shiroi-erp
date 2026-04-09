import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getNetMeteringApplication, getLiaisonDocuments, getLiaisonObjections } from '@/lib/liaison-queries';
import { NetMeteringDetail } from '@/components/liaison/net-metering-detail';
import { formatDate } from '@repo/ui/formatters';
import {
  Card, CardHeader, CardTitle, CardContent, Badge, Button,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@repo/ui';

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function NetMeteringDetailPage({ params }: PageProps) {
  const { projectId } = await params;

  const [application, documents, objections] = await Promise.all([
    getNetMeteringApplication(projectId),
    getLiaisonDocuments(projectId),
    getLiaisonObjections(projectId),
  ]);

  if (!application) notFound();

  const project = (application as any).projects;
  const manager = (application as any).employees;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/liaison/net-metering" className="text-sm text-[#00B050] hover:underline">&larr; Back to Net Metering</Link>
          <h1 className="text-2xl font-bold text-[#1A1D24] mt-1">
            {project?.project_number} — {project?.customer_name}
          </h1>
          <p className="text-sm text-[#7C818E]">
            {project?.system_size_kwp} kWp {project?.system_type?.replace(/_/g, ' ')} · {project?.site_city}
          </p>
        </div>
        <Link href={`/projects/${projectId}`}>
          <Button variant="outline" size="sm">View Project</Button>
        </Link>
      </div>

      {/* Editable status panels */}
      <NetMeteringDetail
        projectId={projectId}
        application={application as any}
        ceigRequired={project?.ceig_required ?? false}
      />

      {/* Documents */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Liaison Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-sm text-[#9CA0AB] text-center py-4">No documents uploaded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Uploaded By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc: any) => (
                  <TableRow key={doc.id}>
                    <TableCell className="text-sm capitalize">{doc.document_type?.replace(/_/g, ' ')}</TableCell>
                    <TableCell>
                      <Badge variant={doc.status === 'accepted' ? 'success' : doc.status === 'rejected' ? 'error' : 'pending'} className="capitalize">
                        {doc.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{doc.submitted_date ? formatDate(doc.submitted_date) : '—'}</TableCell>
                    <TableCell className="text-sm">{doc.employees?.full_name ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Objections */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Objections</CardTitle>
        </CardHeader>
        <CardContent>
          {objections.length === 0 ? (
            <p className="text-sm text-[#9CA0AB] text-center py-4">No objections raised.</p>
          ) : (
            <div className="space-y-3">
              {objections.map((obj: any) => (
                <div key={obj.id} className="rounded-md border border-[#DFE2E8] p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{obj.objection_source} — {obj.objection_type?.replace(/_/g, ' ')}</span>
                    <Badge variant={obj.resolved ? 'success' : 'error'} className="capitalize">
                      {obj.resolved ? 'Resolved' : 'Open'}
                    </Badge>
                  </div>
                  <p className="text-[#3F424D]">{obj.objection_description}</p>
                  <p className="text-xs text-[#9CA0AB]">
                    Raised: {formatDate(obj.objection_date)}
                    {obj.resolved_date && ` · Resolved: ${formatDate(obj.resolved_date)}`}
                    {obj.days_open != null && ` · ${obj.days_open} days`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
