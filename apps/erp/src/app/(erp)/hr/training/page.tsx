import Link from 'next/link';
import { createClient } from '@repo/supabase/server';
import { formatDate } from '@repo/ui/formatters';
import {
  Card,
  CardContent,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
} from '@repo/ui';
import { GraduationCap } from 'lucide-react';

export default async function TrainingPage() {
  let assessments: Array<{
    id: string;
    score_pct: number;
    passed: boolean;
    assessment_date: string;
    attempt_number: number;
    certificate_issued: boolean;
    employees: { full_name: string } | null;
    training_modules: { module_name: string; module_type: string } | null;
  }> = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('training_assessment_results')
      .select('id, score_pct, passed, assessment_date, attempt_number, certificate_issued, employees!training_assessment_results_employee_id_fkey(full_name), training_modules!training_assessment_results_module_id_fkey(module_name, module_type)')
      .order('assessment_date', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[TrainingPage] Query failed:', { code: error.code, message: error.message });
      throw error;
    }
    assessments = (data ?? []) as typeof assessments;
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-heading font-bold text-[#1A1D24]">Training</h1>
        <Card>
          <CardContent>
            <EmptyState
              icon={<GraduationCap className="h-12 w-12" />}
              title="Could not load training records"
              description="No data available. Please try again later."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/hr" className="text-sm text-[#00B050] hover:underline">
            &larr; Back to HR
          </Link>
          <h1 className="text-2xl font-heading font-bold text-[#1A1D24] mt-1">Training</h1>
          <p className="text-sm text-gray-500">
            {assessments.length} assessment{assessments.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Attempt</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Certificate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assessments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={<GraduationCap className="h-12 w-12" />}
                      title="No training records found"
                      description="Training assessments will appear here once employees complete modules."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                assessments.map((rec) => (
                  <TableRow key={rec.id}>
                    <TableCell className="font-medium">
                      {rec.employees?.full_name ?? '—'}
                    </TableCell>
                    <TableCell>{rec.training_modules?.module_name ?? '—'}</TableCell>
                    <TableCell className="capitalize">
                      {rec.training_modules?.module_type?.replace(/_/g, ' ') ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(rec.assessment_date)}
                    </TableCell>
                    <TableCell>{rec.attempt_number}</TableCell>
                    <TableCell>{rec.score_pct}%</TableCell>
                    <TableCell>
                      <Badge variant={rec.passed ? 'default' : 'destructive'}>
                        {rec.passed ? 'Passed' : 'Failed'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={rec.certificate_issued ? 'default' : 'outline'}>
                        {rec.certificate_issued ? 'Issued' : '—'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
