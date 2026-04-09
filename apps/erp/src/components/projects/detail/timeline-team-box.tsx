import { Card, CardHeader, CardTitle, CardContent } from '@repo/ui';
import { EditableField } from './editable-field';
import { Calendar, Users } from 'lucide-react';

interface TimelineTeamBoxProps {
  projectId: string;
  project: {
    order_date: string | null;
    planned_start_date: string | null;
    planned_end_date: string | null;
    actual_start_date: string | null;
    actual_end_date: string | null;
    commissioned_date: string | null;
    project_manager_id: string | null;
    site_supervisor_id: string | null;
  };
  employees: { id: string; full_name: string }[];
}

export function TimelineTeamBox({ projectId, project, employees }: TimelineTeamBoxProps) {
  const employeeOptions = employees.map((e) => ({ value: e.id, label: e.full_name }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="h-4 w-4 text-n-500" />
          Timeline & Team
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Timeline dates */}
        <div className="grid grid-cols-2 gap-4">
          <EditableField
            projectId={projectId}
            field="order_date"
            label="Order Date"
            value={project.order_date}
            type="date"
          />
          <EditableField
            projectId={projectId}
            field="planned_start_date"
            label="Planned Start"
            value={project.planned_start_date}
            type="date"
          />
          <EditableField
            projectId={projectId}
            field="planned_end_date"
            label="Planned End"
            value={project.planned_end_date}
            type="date"
          />
          <EditableField
            projectId={projectId}
            field="actual_start_date"
            label="Actual Start"
            value={project.actual_start_date}
            type="date"
          />
          <EditableField
            projectId={projectId}
            field="actual_end_date"
            label="Actual End"
            value={project.actual_end_date}
            type="date"
          />
          <EditableField
            projectId={projectId}
            field="commissioned_date"
            label="Commissioned"
            value={project.commissioned_date}
            type="date"
          />
        </div>

        <div className="border-t border-n-100 -mx-6" />

        {/* Team */}
        <div>
          <div className="text-xs uppercase tracking-wider text-n-500 mb-3 flex items-center gap-1.5">
            <Users className="h-3 w-3" /> Team
          </div>
          <div className="grid grid-cols-2 gap-4">
            <EditableField
              projectId={projectId}
              field="project_manager_id"
              label="Project Manager"
              value={project.project_manager_id}
              type="select"
              options={employeeOptions}
              placeholder="Unassigned"
            />
            <EditableField
              projectId={projectId}
              field="site_supervisor_id"
              label="Site Supervisor"
              value={project.site_supervisor_id}
              type="select"
              options={employeeOptions}
              placeholder="Unassigned"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
