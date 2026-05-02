'use client';

import { Card, CardContent, Badge } from '@repo/ui';
import { shortINR, formatDate } from '@repo/ui/formatters';
import type { CandidateProject } from '@/lib/orphan-triage-queries';
import { useTriage } from './triage-context';

interface Props {
  project: CandidateProject;
}

export function CandidateCard({ project }: Props) {
  const { selectedProject, setSelectedProject } = useTriage();
  const isSelected = selectedProject?.id === project.project_id;
  const net = Number(project.net_cash_position);
  return (
    <Card
      className={`cursor-pointer transition-all ${isSelected ? 'ring-2 ring-green-600 bg-green-50' : 'hover:shadow-md'}`}
      onClick={() => setSelectedProject({
        id: project.project_id,
        number: project.project_number,
        customer_name: project.customer_name,
      })}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-xs font-bold">{project.customer_name}</p>
            <p className="text-[10px] text-[#7C818E]">{project.project_number}</p>
          </div>
          <Badge variant="outline" className="text-[9px]">{project.status}</Badge>
        </div>
        <div className="text-[10px] text-[#7C818E]">
          {project.system_size_kwp ? `${project.system_size_kwp} kWp` : '—'} · {project.system_type ?? '—'}
        </div>
        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <div><span className="text-[#7C818E]">Contracted</span> <span className="font-mono">{shortINR(Number(project.contracted_value))}</span></div>
          <div><span className="text-[#7C818E]">Invoiced</span> <span className="font-mono">{shortINR(Number(project.total_invoiced))}</span></div>
          <div><span className="text-[#7C818E]">Received</span> <span className="font-mono">{shortINR(Number(project.total_received))}</span></div>
          <div>
            <span className="text-[#7C818E]">Net</span>{' '}
            <span className={`font-mono font-bold ${net < 0 ? 'text-red-600' : 'text-green-700'}`}>
              {shortINR(net)}
            </span>
          </div>
        </div>
        {project.actual_start_date && (
          <p className="text-[9px] text-[#7C818E]">
            Started {formatDate(project.actual_start_date)}
            {project.actual_end_date && ` · Completed ${formatDate(project.actual_end_date)}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
