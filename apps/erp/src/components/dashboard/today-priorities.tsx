import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@repo/ui';
import { AlertTriangle, MapPin } from 'lucide-react';

interface PriorityProject {
  id: string;
  project_number: string;
  customer_name: string;
  city: string;
  status: string;
  reason: string;
}

interface TodayPrioritiesProps {
  projects: PriorityProject[];
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function TodayPriorities({ projects }: TodayPrioritiesProps) {
  return (
    <Card className="bg-[#001F0D] border-[#003D1A]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-white flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[#FCA524]" />
          Today&apos;s Priorities
        </CardTitle>
      </CardHeader>
      <CardContent>
        {projects.length === 0 ? (
          <p className="text-sm text-[#6B7280] py-4 text-center">
            All caught up. No priorities for today.
          </p>
        ) : (
          <div className="space-y-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block rounded-md bg-[#003D1A] p-3 hover:bg-[#004D22] transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {project.project_number}
                    </p>
                    <p className="text-xs text-[#9CA0AB]">{project.customer_name}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <MapPin className="h-3 w-3 text-[#6B7280]" />
                      <span className="text-[11px] text-[#6B7280]">{project.city}</span>
                    </div>
                  </div>
                  <Badge className="bg-[#FEF3C7] text-[#92400E] text-[9px] border-0">
                    {project.reason}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
