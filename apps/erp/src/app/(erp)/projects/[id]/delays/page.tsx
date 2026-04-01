import { notFound } from 'next/navigation';
import { getProject, getProjectDelays } from '@/lib/projects-queries';
import { DelayResponsibilityBadge } from '@/components/projects/delay-responsibility-badge';
import { formatDate } from '@repo/ui/formatters';
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

interface DelaysPageProps {
  params: Promise<{ id: string }>;
}

export default async function DelaysPage({ params }: DelaysPageProps) {
  const { id } = await params;
  const [project, delays] = await Promise.all([
    getProject(id),
    getProjectDelays(id),
  ]);

  if (!project) {
    notFound();
  }

  // Calculate summary stats
  const totalDelayDays = delays.reduce((sum, d) => sum + (d.delay_days ?? 0), 0);
  const responsibilityCounts = delays.reduce<Record<string, number>>((acc, d) => {
    acc[d.responsibility] = (acc[d.responsibility] ?? 0) + (d.delay_days ?? 0);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Summary */}
      {delays.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Delay Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              <div>
                <div className="text-3xl font-bold text-[#991B1B]">{totalDelayDays}</div>
                <div className="text-xs text-muted-foreground">Total Delay Days</div>
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap gap-3">
                  {Object.entries(responsibilityCounts).map(([resp, days]) => (
                    <div key={resp} className="text-sm">
                      <span className="capitalize">{resp}</span>
                      <span className="ml-1 font-mono text-muted-foreground">{days}d</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {delays.length} entries
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Delay responsibility is always required before saving. Weather delays may be auto-logged.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Delay Log Table */}
      {delays.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Responsibility</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Milestone</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead>Customer Notified</TableHead>
                  <TableHead>Logged By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {delays.map((delay) => (
                  <TableRow key={delay.id}>
                    <TableCell>
                      <DelayResponsibilityBadge responsibility={delay.responsibility} />
                      {delay.is_weather_auto && (
                        <span className="ml-1 text-xs text-muted-foreground">(auto)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm max-w-xs truncate">
                      {delay.description}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {delay.project_milestones?.milestone_name ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(delay.delay_start_date)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {delay.delay_end_date ? formatDate(delay.delay_end_date) : 'Ongoing'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {delay.delay_days ?? '—'}
                    </TableCell>
                    <TableCell>
                      {delay.customer_notified ? (
                        <Badge variant="success">Yes</Badge>
                      ) : (
                        <Badge variant="neutral">No</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {delay.employees?.full_name ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No delays recorded for this project.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
