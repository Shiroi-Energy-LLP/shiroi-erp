'use client';

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
import Link from 'next/link';

interface OverdueProject {
  id: string;
  project_number: string;
  customer_name: string;
  status: string;
}

export function OverdueReports({ projects }: { projects: OverdueProject[] }) {
  if (projects.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today&apos;s Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">All active projects have submitted a report today.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Missing Daily Reports
          <Badge variant="error" className="ml-2">{projects.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/projects/${p.id}`} className="text-[#00B050] hover:underline font-medium">
                    {p.project_number}
                  </Link>
                </TableCell>
                <TableCell>{p.customer_name}</TableCell>
                <TableCell>
                  <Badge variant="pending">{p.status.replace(/_/g, ' ')}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
