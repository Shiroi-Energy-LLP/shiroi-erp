import { toIST } from '@repo/ui/formatters';

interface Activity {
  id: string;
  activity_type: string;
  summary: string | null;
  outcome: string | null;
  activity_date: string;
  duration_minutes: number | null;
  next_action: string | null;
  next_action_date: string | null;
  employees: { full_name: string } | null;
}

export function ActivityFeed({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No activities recorded yet.</p>
    );
  }

  return (
    <div className="space-y-0">
      {activities.map((activity, index) => (
        <div key={activity.id} className="relative pl-6 pb-6">
          {/* Timeline line */}
          {index < activities.length - 1 && (
            <div className="absolute left-[9px] top-3 bottom-0 w-px bg-[#D1D5DB]" />
          )}
          {/* Timeline dot */}
          <div className="absolute left-0 top-1 h-[18px] w-[18px] rounded-full border-2 border-[#00B050] bg-white" />

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[#1A1D24]">
                {formatActivityType(activity.activity_type)}
              </span>
              <span className="text-xs text-muted-foreground">
                {toIST(activity.activity_date)}
              </span>
            </div>
            {activity.summary && (
              <p className="text-sm text-[#3E3E3E]">{activity.summary}</p>
            )}
            {activity.outcome && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">Outcome:</span> {activity.outcome}
              </p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {activity.employees?.full_name && (
                <span>By {activity.employees.full_name}</span>
              )}
              {activity.duration_minutes && (
                <span>{activity.duration_minutes} min</span>
              )}
            </div>
            {activity.next_action && (
              <p className="text-xs text-[#00B050] font-medium">
                Next: {activity.next_action}
                {activity.next_action_date && ` (by ${activity.next_action_date})`}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatActivityType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
