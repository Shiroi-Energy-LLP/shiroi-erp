'use client';

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@repo/ui';
import { formatINR } from '@repo/ui/formatters';
import Link from 'next/link';

interface CashProject {
  project_id: string;
  net_cash_position: number;
  is_invested: boolean;
  projects: {
    project_number: string;
    customer_name: string;
    status: string;
  };
}

export function CashAlertTable({ projects }: { projects: CashProject[] }) {
  if (projects.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cash-Negative Projects</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No cash-negative projects. All positions are healthy.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cash-Negative Projects</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Net Position</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => (
              <TableRow key={p.project_id}>
                <TableCell>
                  <Link href={`/projects/${p.project_id}`} className="text-[#00B050] hover:underline font-medium">
                    {p.projects.project_number}
                  </Link>
                </TableCell>
                <TableCell>{p.projects.customer_name}</TableCell>
                <TableCell className="text-right font-mono text-[#991B1B]">
                  {formatINR(p.net_cash_position)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
